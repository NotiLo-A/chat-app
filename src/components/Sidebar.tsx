import type { Channel } from '../types';

interface SidebarProps {
  curChat: string;
  channels: Channel[];
  openedDMs: string[];
  onlineUsers: string[];
  unread: Record<string, number>;
  myUser: string;
  onSelectChat: (ch: string) => void;
  onCreateChannel: () => void;
  onDeleteChannel: (channelId: string) => void;
  onCloseDM: (peer: string) => void;
}

export function Sidebar({
  curChat, channels, openedDMs, onlineUsers, unread, myUser,
  onSelectChat, onCreateChannel, onDeleteChannel, onCloseDM,
}: SidebarProps) {
  return (
    <div className="sidebar">
      {/* ── Channels ── */}
      <div className="sidebar-half">
        <div className="sidebar-section">
          <span>channels</span>
          <button
            className="new-channel-btn"
            onClick={onCreateChannel}
            title="New channel"
          >+</button>
        </div>
        <div className="chat-list">
          {/* global — always present, not deletable */}
          <div
            className={`chat-item${curChat === '__global__' ? ' active' : ''}`}
            data-ch="__global__"
            onClick={() => onSelectChat('__global__')}
          >
            <div className="chat-dot online" />
            <div className="chat-name">#&nbsp;global</div>
            {(unread['__global__'] ?? 0) > 0 && (
              <div className="unread-badge">{unread['__global__']}</div>
            )}
          </div>

          {/* custom channels */}
          {channels.map(ch => {
            const isActive  = curChat === ch.id;
            const badge     = unread[ch.id] ?? 0;
            const isCreator = ch.created_by === myUser;
            return (
              <div
                key={ch.id}
                className={`chat-item can-delete${isActive ? ' active' : ''}`}
                data-ch={ch.id}
                onClick={() => onSelectChat(ch.id)}
              >
                <div className="chat-dot" />
                <div className="chat-name">#&nbsp;{ch.name}</div>
                {badge > 0 && <div className="unread-badge">{badge}</div>}
                {isCreator && (
                  <button
                    className="item-del-btn"
                    title="Delete channel"
                    onClick={e => { e.stopPropagation(); onDeleteChannel(ch.id); }}
                  >×</button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Direct messages ── */}
      <div className="sidebar-half border-top">
        <div className="sidebar-section">
          <span>direct messages</span>
        </div>
        <div className="chat-list">
          {openedDMs.length === 0 ? (
            <div className="dm-empty">no conversations yet</div>
          ) : (
            openedDMs.map(u => {
              const isOnline = onlineUsers.includes(u);
              const isActive = curChat === u;
              const badge    = unread[u] ?? 0;
              return (
                <div
                  key={u}
                  className={`chat-item can-delete${isOnline ? ' online' : ''}${isActive ? ' active' : ''}`}
                  data-ch={u}
                  onClick={() => onSelectChat(u)}
                >
                  <div className={`chat-dot${isOnline ? ' online' : ''}`} />
                  <div className="chat-name">{u}</div>
                  {badge > 0 && <div className="unread-badge">{badge}</div>}
                  <button
                    className="item-del-btn"
                    title="Close conversation"
                    onClick={e => { e.stopPropagation(); onCloseDM(u); }}
                  >×</button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
