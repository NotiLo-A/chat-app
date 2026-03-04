import type { Channel } from '../types';

interface UsersPanelProps {
  curChat: string;
  myUser: string;
  allUsers: string[];
  onlineUsers: string[];
  channels: Channel[];
  onOpenDM: (username: string) => void;
}

export function UsersPanel({
  curChat, myUser, allUsers, onlineUsers, channels, onOpenDM,
}: UsersPanelProps) {
  const isGlobal  = curChat === '__global__';
  const isChannel = curChat.startsWith('ch_');
  const isDM      = !isGlobal && !isChannel;

  let title: string;
  let users: string[];
  let canDMAll = false;

  if (isDM) {
    title = 'participants';
    users = [myUser, curChat];
  } else if (isChannel) {
    const ch = channels.find(c => c.id === curChat);
    title = 'members';
    users = ch ? [...ch.members].sort((a, b) => {
      const aOn = onlineUsers.includes(a);
      const bOn = onlineUsers.includes(b);
      if (aOn !== bOn) return aOn ? -1 : 1;
      return a.localeCompare(b);
    }) : [];
  } else {
    title = 'users';
    canDMAll = true;
    users = [...allUsers].sort((a, b) => {
      const aOn = onlineUsers.includes(a);
      const bOn = onlineUsers.includes(b);
      if (aOn !== bOn) return aOn ? -1 : 1;
      return a.localeCompare(b);
    });
  }

  return (
    <div className="users-panel">
      <div className="users-panel-header">{title}</div>
      <div className="users-panel-list">
        {users.length === 0 ? (
          <div className="users-panel-empty">no users yet</div>
        ) : (
          users.map(u => {
            const isOnline = onlineUsers.includes(u);
            const isMe     = u === myUser;
            const canDM    = canDMAll && !isMe;
            return (
              <div
                key={u}
                className={`user-item${isMe ? ' is-me' : canDM ? ' can-dm' : ''}`}
                title={canDM ? `Open DM with ${u}` : undefined}
                onClick={canDM ? () => onOpenDM(u) : undefined}
              >
                <div className={`user-dot${isOnline ? ' online' : ''}`} />
                <div className="user-name">
                  {u}
                  {isMe && <span className="you-label"> (you)</span>}
                </div>
                {canDM && <div className="user-dm-hint">dm</div>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
