import { useState, useCallback, useRef } from 'react';
import { AuthScreen }         from './components/AuthScreen';
import { Sidebar }            from './components/Sidebar';
import { ChatPane }           from './components/ChatPane';
import { UsersPanel }         from './components/UsersPanel';
import { CreateChannelModal } from './components/CreateChannelModal';
import { useWebSocket }       from './hooks/useWebSocket';
import type { AuthStatus, Channel, ChatMessage, ServerMessage } from './types';

const GLOBAL = '__global__';

export function App() {
  // ── Auth ──────────────────────────────────────────────────────────
  const [myUser,     setMyUser]     = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>({ msg: '', type: '' });

  // ── Theme ─────────────────────────────────────────────────────────
  const [isDark, setIsDark] = useState(false);
  const toggleTheme = () => {
    setIsDark(prev => {
      const next = !prev;
      document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
      return next;
    });
  };

  // ── Chat state ────────────────────────────────────────────────────
  const [curChat,     setCurChat]     = useState<string>(GLOBAL);
  const [allUsers,    setAllUsers]    = useState<string[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [openedDMs,   setOpenedDMs]   = useState<string[]>([]);
  const [channels,    setChannels]    = useState<Channel[]>([]);
  const [unread,      setUnread]      = useState<Record<string, number>>({});
  const [history,     setHistory]     = useState<Record<string, ChatMessage[]>>({ [GLOBAL]: [] });

  // ── Modal ─────────────────────────────────────────────────────────
  const [showModal, setShowModal] = useState(false);

  const curChatRef = useRef(curChat);
  curChatRef.current = curChat;
  const myUserRef = useRef(myUser);
  myUserRef.current = myUser;

  // ── WebSocket handler ─────────────────────────────────────────────
  const handleMessage = useCallback((data: ServerMessage) => {
    switch (data.type) {
      case 'auth_ok':
        setMyUser(data.username);
        setAuthStatus({ msg: '', type: '' });
        break;

      case 'auth_error':
        setAuthStatus({ msg: data.msg || 'Authentication failed.', type: 'err' });
        break;

      case 'user_list':
        setAllUsers(data.users || []);
        setOnlineUsers(data.online || []);
        break;

      case 'contacts':
        setOpenedDMs(prev => {
          const set = new Set(prev);
          (data.contacts || []).forEach(u => set.add(u));
          return [...set];
        });
        break;

      case 'channels':
        setChannels(data.channels || []);
        // init history slots for channels
        setHistory(prev => {
          const next = { ...prev };
          (data.channels || []).forEach(ch => {
            if (!next[ch.id]) next[ch.id] = [];
          });
          return next;
        });
        break;

      case 'channel_created':
        setChannels(prev =>
          prev.find(c => c.id === data.channel.id)
            ? prev
            : [...prev, data.channel]
        );
        setHistory(prev =>
          prev[data.channel.id] ? prev : { ...prev, [data.channel.id]: [] }
        );
        break;

      case 'channel_deleted':
        setChannels(prev => prev.filter(c => c.id !== data.channel_id));
        setHistory(prev => {
          const next = { ...prev };
          delete next[data.channel_id];
          return next;
        });
        // if we were in that channel → go to global
        if (curChatRef.current === data.channel_id) {
          setCurChat(GLOBAL);
        }
        break;

      case 'history':
        setHistory(prev => ({ ...prev, [data.channel]: data.messages || [] }));
        break;

      case 'message_deleted':
        setHistory(prev => {
          const msgs = prev[data.channel];
          if (!msgs) return prev;
          return {
            ...prev,
            [data.channel]: msgs.filter(m => m.id !== data.msg_id),
          };
        });
        break;

      case 'message': {
        const ch = data.to === GLOBAL
          ? GLOBAL
          : data.to.startsWith('ch_')
            ? data.to
            : (data.from === myUserRef.current ? data.to : data.from);

        setHistory(prev => ({
          ...prev,
          [ch]: [...(prev[ch] || []), data],
        }));

        if (ch !== GLOBAL && !ch.startsWith('ch_')) {
          setOpenedDMs(prev => prev.includes(ch) ? prev : [...prev, ch]);
        }

        if (ch !== curChatRef.current) {
          setUnread(prev => ({ ...prev, [ch]: (prev[ch] || 0) + 1 }));
        }
        break;
      }
    }
  }, []);

  const { connect, send, close } = useWebSocket(handleMessage);

  // ── Auth actions ──────────────────────────────────────────────────
  const doLogin = (username: string, password: string) => {
    if (!username || !password) {
      setAuthStatus({ msg: 'Fill in all fields.', type: 'err' });
      return;
    }
    setAuthStatus({ msg: 'connecting...', type: '' });
    connect(() => send({ type: 'login', username, password }));
  };

  const doRegister = (username: string, password: string) => {
    if (!username || !password) {
      setAuthStatus({ msg: 'Fill in all fields.', type: 'err' });
      return;
    }
    setAuthStatus({ msg: 'connecting...', type: '' });
    connect(() => send({ type: 'register', username, password }));
  };

  const doLogout = () => {
    close();
    setMyUser(null);
    setAllUsers([]);
    setOnlineUsers([]);
    setOpenedDMs([]);
    setChannels([]);
    setUnread({});
    setHistory({ [GLOBAL]: [] });
    setCurChat(GLOBAL);
    setAuthStatus({ msg: '', type: '' });
  };

  // ── Select chat ───────────────────────────────────────────────────
  const selectChat = (ch: string) => {
    setCurChat(ch);
    setUnread(prev => ({ ...prev, [ch]: 0 }));
    if (ch !== GLOBAL && !history[ch]) {
      send({ type: 'get_history', with: ch });
    }
  };

  // ── Open DM ───────────────────────────────────────────────────────
  const openDM = (username: string) => {
    setOpenedDMs(prev => prev.includes(username) ? prev : [...prev, username]);
    selectChat(username);
  };

  // ── Close DM ──────────────────────────────────────────────────────
  const closeDM = (peer: string) => {
    send({ type: 'close_dm', peer });
    setOpenedDMs(prev => prev.filter(u => u !== peer));
    if (curChatRef.current === peer) setCurChat(GLOBAL);
  };

  // ── Create channel ────────────────────────────────────────────────
  const createChannel = (name: string, members: string[]) => {
    send({ type: 'create_channel', name, members });
    setShowModal(false);
  };

  // ── Delete channel ────────────────────────────────────────────────
  const deleteChannel = (channelId: string) => {
    send({ type: 'delete_channel', channel_id: channelId });
  };

  // ── Delete message ────────────────────────────────────────────────
  const deleteMessage = (msgId: number, channel: string) => {
    send({ type: 'delete_message', msg_id: msgId, channel });
  };

  // ── Send message ──────────────────────────────────────────────────
  const sendMessage = (content: string) => {
    send({ type: 'message', to: curChat, content });
  };

  // ── Render ────────────────────────────────────────────────────────
  if (!myUser) {
    return (
      <AuthScreen
        status={authStatus}
        onLogin={doLogin}
        onRegister={doRegister}
        onToggleTheme={toggleTheme}
        isDark={isDark}
      />
    );
  }

  const currentMessages = history[curChat] || [];

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-title">chat</div>
        <div className="topbar-user">
          logged in as <strong>{myUser}</strong>
        </div>
        <button className="topbar-theme-btn" onClick={toggleTheme}>
          {isDark ? 'dark' : 'light'}
        </button>
        <button className="logout-btn" onClick={doLogout}>logout</button>
      </div>

      <div className="main">
        <Sidebar
          curChat={curChat}
          channels={channels}
          openedDMs={openedDMs}
          onlineUsers={onlineUsers}
          unread={unread}
          myUser={myUser}
          onSelectChat={selectChat}
          onCreateChannel={() => setShowModal(true)}
          onDeleteChannel={deleteChannel}
          onCloseDM={closeDM}
        />

        <ChatPane
          curChat={curChat}
          myUser={myUser}
          messages={currentMessages}
          onlineUsers={onlineUsers}
          channels={channels}
          onSend={sendMessage}
          onDeleteMessage={deleteMessage}
        />

        <UsersPanel
          curChat={curChat}
          myUser={myUser}
          allUsers={allUsers}
          onlineUsers={onlineUsers}
          channels={channels}
          onOpenDM={openDM}
        />
      </div>

      {showModal && (
        <CreateChannelModal
          openedDMs={openedDMs}
          onConfirm={createChannel}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
