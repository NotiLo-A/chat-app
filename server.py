#!/usr/bin/env python3
"""
CLI-style Browser Chat — WebSocket + HTTP server
https://github.com/NotiLo-A/chat-app

Configuration via environment variables (copy .env.example → .env).

Run:
    pip install -r requirements.txt
    python server.py
"""

import asyncio
import datetime
import hashlib
import json
import logging
import os
import posixpath
import signal
import sqlite3
import threading
import uuid
from functools import partial

import bcrypt
import websockets
from websockets.exceptions import ConnectionClosed

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("chat")


BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, os.getenv("STATIC_DIR", "dist"))
DB_FILE    = os.path.join(BASE_DIR, os.getenv("DB_FILE",    "chat.db"))

HTTP_HOST = os.getenv("HTTP_HOST", "127.0.0.1")
HTTP_PORT = int(os.getenv("HTTP_PORT", "8080"))
WS_HOST   = os.getenv("WS_HOST",   "127.0.0.1")
WS_PORT   = int(os.getenv("WS_PORT",   "8765"))

MAX_MSG_LEN = int(os.getenv("MAX_MSG_LEN",   "4000"))
MAX_WS_SIZE = int(os.getenv("MAX_WS_SIZE",   "65536"))
GLOBAL_HIST = int(os.getenv("GLOBAL_HIST",   "200"))

RATE_LIMIT_ATTEMPTS = int(os.getenv("RATE_LIMIT_ATTEMPTS", "10"))
RATE_LIMIT_WINDOW   = int(os.getenv("RATE_LIMIT_WINDOW",   "60"))

MIME_TYPES = {
    ".html":  "text/html; charset=utf-8",
    ".js":    "application/javascript",
    ".mjs":   "application/javascript",
    ".css":   "text/css",
    ".json":  "application/json",
    ".svg":   "image/svg+xml",
    ".png":   "image/png",
    ".jpg":   "image/jpeg",
    ".jpeg":  "image/jpeg",
    ".ico":   "image/x-icon",
    ".woff":  "font/woff",
    ".woff2": "font/woff2",
    ".ttf":   "font/ttf",
    ".txt":   "text/plain",
}


connected: dict[str, object] = {}


class RateLimiter:
   
    def __init__(self, max_attempts: int, window_seconds: int):
        self._max = max_attempts
        self._window = window_seconds
        self._attempts: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def is_allowed(self, key: str) -> bool:
        now = datetime.datetime.now().timestamp()
        with self._lock:
            history = self._attempts.get(key, [])
            history = [t for t in history if now - t < self._window]
            if len(history) >= self._max:
                return False
            history.append(now)
            self._attempts[key] = history
            return True

    def cleanup(self):
        now = datetime.datetime.now().timestamp()
        with self._lock:
            self._attempts = {
                k: [t for t in v if now - t < self._window]
                for k, v in self._attempts.items()
                if any(now - t < self._window for t in v)
            }


rate_limiter = RateLimiter(RATE_LIMIT_ATTEMPTS, RATE_LIMIT_WINDOW)


_local = threading.local()


def get_db() -> sqlite3.Connection:
    if not hasattr(_local, "conn"):
        conn = sqlite3.connect(DB_FILE, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return _local.conn


def init_db():
    db = get_db()
    db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            username   TEXT PRIMARY KEY,
            password   TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            from_user  TEXT NOT NULL,
            to_chan    TEXT NOT NULL,
            content    TEXT NOT NULL,
            ts         TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_chan ON messages (to_chan, id);

        CREATE TABLE IF NOT EXISTS dm_contacts (
            owner      TEXT NOT NULL,
            peer       TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (owner, peer)
        );

        CREATE TABLE IF NOT EXISTS channels (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS channel_members (
            channel_id TEXT NOT NULL,
            username   TEXT NOT NULL,
            PRIMARY KEY (channel_id, username),
            FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
        );
    """)
    db.commit()
    log.info("SQLite ready: %s", DB_FILE)


def _db_get_user(username: str):
    return get_db().execute(
        "SELECT * FROM users WHERE username = ?", (username,)
    ).fetchone()


def _db_create_user(username: str, pw_hash: str):
    db  = get_db()
    now = datetime.datetime.now().isoformat(timespec="seconds")
    db.execute(
        "INSERT INTO users (username, password, created_at) VALUES (?, ?, ?)",
        (username, pw_hash, now),
    )
    db.commit()


def _db_update_password(username: str, pw_hash: str):
    """Re-hash a legacy SHA-256 password to bcrypt on next login."""
    db = get_db()
    db.execute(
        "UPDATE users SET password = ? WHERE username = ?",
        (pw_hash, username),
    )
    db.commit()


def _db_all_users() -> list[str]:
    rows = get_db().execute(
        "SELECT username FROM users ORDER BY username"
    ).fetchall()
    return [r["username"] for r in rows]


def _db_save_message(from_user: str, to_chan: str, content: str, ts: str) -> int:
    db  = get_db()
    now = datetime.datetime.now().isoformat(timespec="seconds")
    cur = db.execute(
        "INSERT INTO messages (from_user, to_chan, content, ts, created_at)"
        " VALUES (?, ?, ?, ?, ?)",
        (from_user, to_chan, content, ts, now),
    )
    db.commit()
    return cur.lastrowid


def _msg_row_to_dict(r) -> dict:
    return {
        "type":    "message",
        "id":      r["id"],
        "from":    r["from_user"],
        "to":      r["to_chan"],
        "content": r["content"],
        "ts":      r["ts"],
    }


def _db_global_history(limit: int) -> list[dict]:
    rows = get_db().execute(
        """SELECT id, from_user, to_chan, content, ts
           FROM messages WHERE to_chan = '__global__'
           ORDER BY id DESC LIMIT ?""",
        (limit,),
    ).fetchall()
    return [_msg_row_to_dict(r) for r in reversed(rows)]


def _db_dm_history(user_a: str, user_b: str) -> list[dict]:
    rows = get_db().execute(
        """SELECT id, from_user, to_chan, content, ts
           FROM messages
           WHERE (from_user = ? AND to_chan = ?)
              OR (from_user = ? AND to_chan = ?)
           ORDER BY id ASC""",
        (user_a, user_b, user_b, user_a),
    ).fetchall()
    return [_msg_row_to_dict(r) for r in rows]


def _db_channel_history(channel_id: str) -> list[dict]:
    rows = get_db().execute(
        """SELECT id, from_user, to_chan, content, ts
           FROM messages WHERE to_chan = ?
           ORDER BY id ASC""",
        (channel_id,),
    ).fetchall()
    return [_msg_row_to_dict(r) for r in rows]


def _db_get_contacts(owner: str) -> list[str]:
    rows = get_db().execute(
        "SELECT peer FROM dm_contacts WHERE owner = ? ORDER BY created_at ASC",
        (owner,),
    ).fetchall()
    return [r["peer"] for r in rows]


def _db_add_contact(owner: str, peer: str):
    db  = get_db()
    now = datetime.datetime.now().isoformat(timespec="seconds")
    db.execute(
        "INSERT OR IGNORE INTO dm_contacts (owner, peer, created_at) VALUES (?, ?, ?)",
        (owner, peer, now),
    )
    db.commit()


def _db_remove_contact(owner: str, peer: str):
    db = get_db()
    db.execute(
        "DELETE FROM dm_contacts WHERE owner = ? AND peer = ?", (owner, peer)
    )
    db.commit()


def _db_create_channel(channel_id: str, name: str, created_by: str, members: list[str]):
    db  = get_db()
    now = datetime.datetime.now().isoformat(timespec="seconds")
    db.execute(
        "INSERT INTO channels (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
        (channel_id, name, created_by, now),
    )
    for m in members:
        db.execute(
            "INSERT OR IGNORE INTO channel_members (channel_id, username) VALUES (?, ?)",
            (channel_id, m),
        )
    db.commit()


def _db_delete_channel(channel_id: str):
    db = get_db()
    db.execute("DELETE FROM messages        WHERE to_chan    = ?", (channel_id,))
    db.execute("DELETE FROM channel_members WHERE channel_id = ?", (channel_id,))
    db.execute("DELETE FROM channels        WHERE id         = ?", (channel_id,))
    db.commit()


def _db_get_channel(channel_id: str) -> dict | None:
    db   = get_db()
    chan = db.execute(
        "SELECT * FROM channels WHERE id = ?", (channel_id,)
    ).fetchone()
    if not chan:
        return None
    members_rows = db.execute(
        "SELECT username FROM channel_members WHERE channel_id = ?", (channel_id,)
    ).fetchall()
    return {
        "id":         chan["id"],
        "name":       chan["name"],
        "created_by": chan["created_by"],
        "members":    [r["username"] for r in members_rows],
    }


def _db_get_user_channels(username: str) -> list[dict]:
    db = get_db()
    rows = db.execute(
        """SELECT c.id FROM channels c
           JOIN channel_members cm ON c.id = cm.channel_id
           WHERE cm.username = ?
           ORDER BY c.created_at ASC""",
        (username,),
    ).fetchall()
    result = []
    for r in rows:
        ch = _db_get_channel(r["id"])
        if ch:
            result.append(ch)
    return result


def _db_get_channel_members(channel_id: str) -> list[str]:
    rows = get_db().execute(
        "SELECT username FROM channel_members WHERE channel_id = ?", (channel_id,)
    ).fetchall()
    return [r["username"] for r in rows]


def _db_delete_message(msg_id: int, username: str) -> str | None:
    """Delete a message owned by *username*. Returns ``to_chan`` on success."""
    db  = get_db()
    row = db.execute(
        "SELECT to_chan, from_user FROM messages WHERE id = ?", (msg_id,)
    ).fetchone()
    if not row or row["from_user"] != username:
        return None
    db.execute("DELETE FROM messages WHERE id = ?", (msg_id,))
    db.commit()
    return row["to_chan"]


def _run(fn, *args):
    loop = asyncio.get_running_loop()
    return loop.run_in_executor(None, partial(fn, *args))


async def db_get_user(u):             return await _run(_db_get_user, u)
async def db_create_user(u, h):       return await _run(_db_create_user, u, h)
async def db_update_password(u, h):   return await _run(_db_update_password, u, h)
async def db_all_users():             return await _run(_db_all_users)
async def db_save_message(f, t, c, ts): return await _run(_db_save_message, f, t, c, ts)
async def db_global_history():        return await _run(_db_global_history, GLOBAL_HIST)
async def db_dm_history(a, b):        return await _run(_db_dm_history, a, b)
async def db_channel_history(ch):     return await _run(_db_channel_history, ch)
async def db_get_contacts(u):         return await _run(_db_get_contacts, u)
async def db_add_contact(o, p):       return await _run(_db_add_contact, o, p)
async def db_remove_contact(o, p):    return await _run(_db_remove_contact, o, p)
async def db_create_channel(i, n, c, m): return await _run(_db_create_channel, i, n, c, m)
async def db_delete_channel(i):       return await _run(_db_delete_channel, i)
async def db_get_channel(i):          return await _run(_db_get_channel, i)
async def db_get_user_channels(u):    return await _run(_db_get_user_channels, u)
async def db_get_channel_members(i):  return await _run(_db_get_channel_members, i)
async def db_delete_message(mid, u):  return await _run(_db_delete_message, mid, u)


_BCRYPT_ROUNDS = int(os.getenv("BCRYPT_ROUNDS", "12"))

_LEGACY_PREFIX = "sha256:"


def _legacy_hash(pw: str) -> str:
    return _LEGACY_PREFIX + hashlib.sha256(pw.encode()).hexdigest()


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)).decode()


def _check_pw_sync(pw: str, stored: str) -> tuple[bool, str | None]:
    if stored.startswith(_LEGACY_PREFIX):
        digest = stored[len(_LEGACY_PREFIX):]
        ok = hashlib.sha256(pw.encode()).hexdigest() == digest
        new_hash = hash_pw(pw) if ok else None
        return ok, new_hash

    ok = bcrypt.checkpw(pw.encode(), stored.encode())
    return ok, None


async def check_pw(pw: str, stored: str) -> tuple[bool, str | None]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _check_pw_sync, pw, stored)


def now_ts() -> str:
    return datetime.datetime.now().strftime("%H:%M")


async def send_json(ws, payload: dict):
    try:
        await ws.send(json.dumps(payload))
    except Exception:
        pass


async def broadcast_user_list():
    all_users = await db_all_users()
    payload = {
        "type":   "user_list",
        "users":  all_users,
        "online": list(connected.keys()),
    }
    for ws in list(connected.values()):
        await send_json(ws, payload)


async def send_login_data(ws, username: str):
    await send_json(ws, {"type": "auth_ok", "username": username})
    await broadcast_user_list()

    contacts = await db_get_contacts(username)
    await send_json(ws, {"type": "contacts", "contacts": contacts})

    channels = await db_get_user_channels(username)
    await send_json(ws, {"type": "channels", "channels": channels})

    hist = await db_global_history()
    await send_json(ws, {"type": "history", "channel": "__global__", "messages": hist})


async def ws_handler(ws):
    username: str | None = None
    peer_ip = ws.remote_address[0] if ws.remote_address else "unknown"

    try:
        async for raw in ws:
            try:
                data = json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                continue

            t = data.get("type", "")

            if t == "register":
                if not rate_limiter.is_allowed(f"auth:{peer_ip}"):
                    await send_json(ws, {
                        "type": "auth_error",
                        "msg":  "Too many attempts. Please wait a moment.",
                    })
                    continue

                uname = data.get("username", "").strip()[:64]
                pw    = data.get("password", "")[:256]

                if not uname or not pw:
                    await send_json(ws, {"type": "auth_error",
                                         "msg": "Username and password required."})
                elif len(uname) < 3:
                    await send_json(ws, {"type": "auth_error",
                                         "msg": "Username must be at least 3 characters."})
                elif not uname.replace("_", "").replace("-", "").isalnum():
                    await send_json(ws, {"type": "auth_error",
                                         "msg": "Username: letters, digits, - and _ only."})
                elif await db_get_user(uname):
                    await send_json(ws, {"type": "auth_error",
                                         "msg": "Username already taken."})
                else:
                    pw_hash = await asyncio.get_running_loop().run_in_executor(
                        None, hash_pw, pw
                    )
                    await db_create_user(uname, pw_hash)
                    username = uname
                    connected[username] = ws
                    log.info("Registered: %s from %s", username, peer_ip)
                    await send_login_data(ws, username)

            elif t == "login":
                if not rate_limiter.is_allowed(f"auth:{peer_ip}"):
                    await send_json(ws, {
                        "type": "auth_error",
                        "msg":  "Too many attempts. Please wait a moment.",
                    })
                    continue

                uname = data.get("username", "").strip()[:64]
                pw    = data.get("password", "")[:256]
                row   = await db_get_user(uname)

                if not row:
                    await send_json(ws, {"type": "auth_error", "msg": "User not found."})
                else:
                    ok, new_hash = await check_pw(pw, row["password"])
                    if not ok:
                        await send_json(ws, {"type": "auth_error", "msg": "Wrong password."})
                    else:
                        if new_hash:
                             await db_update_password(uname, new_hash)

                        username = uname
                        connected[username] = ws
                        log.info("Login: %s from %s", username, peer_ip)
                        await send_login_data(ws, username)

            elif t == "message":
                if not username:
                    continue
                to      = data.get("to", "__global__")
                content = data.get("content", "").strip()[:MAX_MSG_LEN]
                if not content:
                    continue

                ts     = now_ts()
                msg_id = await db_save_message(username, to, content, ts)
                msg = {
                    "type":    "message",
                    "id":      msg_id,
                    "from":    username,
                    "to":      to,
                    "content": content,
                    "ts":      ts,
                }

                if to == "__global__":
                    for ws2 in list(connected.values()):
                        await send_json(ws2, msg)

                elif to.startswith("ch_"):
                    members = await db_get_channel_members(to)
                    for m in members:
                        if m in connected:
                            await send_json(connected[m], msg)

                else:
                    await db_add_contact(username, to)
                    await db_add_contact(to, username)
                    await send_json(ws, msg)
                    if to in connected:
                        await send_json(connected[to], msg)

            elif t == "get_history":
                if not username:
                    continue
                target = data.get("with", "")[:64]
                if target.startswith("ch_"):
                    hist = await db_channel_history(target)
                else:
                    hist = await db_dm_history(username, target)
                await send_json(ws, {
                    "type":     "history",
                    "channel":  target,
                    "messages": hist,
                })

            elif t == "create_channel":
                if not username:
                    continue
                name = data.get("name", "").strip()[:64]
                if not name:
                    continue
                raw_members = data.get("members", [])
                members = [str(m)[:64] for m in raw_members if isinstance(m, str)]
                if username not in members:
                    members.append(username)

                channel_id = "ch_" + uuid.uuid4().hex[:16]
                await db_create_channel(channel_id, name, username, members)

                channel = await db_get_channel(channel_id)
                if channel:
                    payload = {"type": "channel_created", "channel": channel}
                    for m in members:
                        if m in connected:
                            await send_json(connected[m], payload)
                    log.info("Channel created: %s by %s", name, username)

            elif t == "delete_channel":
                if not username:
                    continue
                channel_id = data.get("channel_id", "")
                if not channel_id.startswith("ch_"):
                    continue
                channel = await db_get_channel(channel_id)
                if not channel or channel["created_by"] != username:
                    continue 

                members = channel["members"]
                await db_delete_channel(channel_id)
                payload = {"type": "channel_deleted", "channel_id": channel_id}
                for m in members:
                    if m in connected:
                        await send_json(connected[m], payload)
                log.info("Channel deleted: %s by %s", channel_id, username)

            elif t == "close_dm":
                if not username:
                    continue
                peer = data.get("peer", "")[:64]
                if peer:
                    await db_remove_contact(username, peer)

            elif t == "delete_message":
                if not username:
                    continue
                msg_id = data.get("msg_id")
                if not isinstance(msg_id, int):
                    continue

                to_chan = await db_delete_message(msg_id, username)
                if not to_chan:
                    continue  

                payload = {
                    "type":    "message_deleted",
                    "msg_id":  msg_id,
                    "channel": to_chan,
                }

                if to_chan == "__global__":
                    for ws2 in list(connected.values()):
                        await send_json(ws2, payload)

                elif to_chan.startswith("ch_"):
                    members = await db_get_channel_members(to_chan)
                    for m in members:
                        if m in connected:
                            await send_json(connected[m], payload)

                else:
                    await send_json(ws, payload)
                    if to_chan in connected and connected[to_chan] is not ws:
                        await send_json(connected[to_chan], payload)

    except ConnectionClosed:
        pass
    except Exception as exc:
        log.exception("Unhandled error in ws_handler for %s: %s", peer_ip, exc)
    finally:
        if username and connected.get(username) is ws:
            del connected[username]
            log.info("Disconnected: %s", username)
            await broadcast_user_list()


async def http_handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        request_line = await asyncio.wait_for(reader.readline(), timeout=10)

        while True:
            line = await asyncio.wait_for(reader.readline(), timeout=10)
            if line in (b"\r\n", b"\n", b""):
                break

        parts = request_line.decode(errors="replace").split()
        path  = parts[1] if len(parts) >= 2 else "/"
        path  = path.split("?")[0]

        if path in ("/", ""):
            path = "/index.html"

        safe_path = posixpath.normpath(path).lstrip("/")
        file_path = os.path.join(STATIC_DIR, safe_path.replace("/", os.sep))

        if not os.path.abspath(file_path).startswith(os.path.abspath(STATIC_DIR)):
            file_path = os.path.join(STATIC_DIR, "index.html")

        if not os.path.isfile(file_path):
            file_path = os.path.join(STATIC_DIR, "index.html")

        ext       = os.path.splitext(file_path)[1].lower()
        mime_type = MIME_TYPES.get(ext, "application/octet-stream")

        try:
            with open(file_path, "rb") as f:
                body = f.read()

            cache_header = (
                b"Cache-Control: public, max-age=31536000\r\n"
                if ext not in (".html",)
                else b""
            )
            response = (
                b"HTTP/1.1 200 OK\r\n"
                b"Content-Type: " + mime_type.encode() + b"\r\n"
                b"Connection: close\r\n"
                + cache_header
                + b"Content-Length: " + str(len(body)).encode() + b"\r\n"
                b"\r\n"
                + body
            )
        except FileNotFoundError:
            response = (
                b"HTTP/1.1 404 Not Found\r\n"
                b"Content-Type: text/plain\r\n"
                b"Connection: close\r\n\r\n"
                b"Not found\n"
            )

        writer.write(response)
        await writer.drain()

    except Exception:
        pass
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


async def cleanup_task():
    """Periodically prune stale rate-limiter entries."""
    while True:
        await asyncio.sleep(300)  # every 5 minutes
        rate_limiter.cleanup()
        log.debug("Rate limiter cleaned up.")


async def main():
    init_db()

    http_server = await asyncio.start_server(http_handler, HTTP_HOST, HTTP_PORT)
    ws_server   = await websockets.serve(
        ws_handler, WS_HOST, WS_PORT,
        max_size=MAX_WS_SIZE,
    )

    print()
    print("  ┌───────────────────────────────────")
    print(f"  │  CLI Browser Chat  •  ready      ")
    print(f"  │  HTTP  →  http://{HTTP_HOST}:{HTTP_PORT}")
    print(f"  │  WS    →  ws://{WS_HOST}:{WS_PORT}      ")
    print("  └───────────────────────────────────")
    print()
    log.info("Press Ctrl+C to stop.")

    loop = asyncio.get_running_loop()

    def _shutdown():
        log.info("Shutting down…")
        for task in asyncio.all_tasks(loop):
            task.cancel()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _shutdown)
        except NotImplementedError:
            pass

    asyncio.create_task(cleanup_task())

    async with http_server, ws_server:
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            pass

    log.info("Server stopped.")


if __name__ == "__main__":
    asyncio.run(main())
