import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Channel, ChatMessage } from '../types';

interface ChatPaneProps {
  curChat: string | null;
  myUser: string;
  messages: ChatMessage[];
  onlineUsers: string[];
  channels: Channel[];
  onSend: (content: string) => void;
  onDeleteMessage: (msgId: number, channel: string) => void;
}

export function ChatPane({
  curChat, myUser, messages, onlineUsers, channels,
  onSend, onDeleteMessage,
}: ChatPaneProps) {
  const [text, setText]   = useState('');
  const msgBoxRef         = useRef<HTMLDivElement>(null);
  const textareaRef       = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (msgBoxRef.current) {
      msgBoxRef.current.scrollTop = msgBoxRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [curChat]);

  const handleInput = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMsg();
    }
  };

  const sendMsg = () => {
    const content = text.trim();
    if (!content || !curChat) return;
    onSend(content);
    setText('');
    if (textareaRef.current) textareaRef.current.style.height = '';
    textareaRef.current?.focus();
  };

  if (!curChat) {
    return (
      <div className="chat-pane">
        <div className="no-chat">
          <div className="no-chat-title">select a chat</div>
          <div className="no-chat-sub">click a user on the right to start a DM</div>
        </div>
      </div>
    );
  }

  const isGlobal  = curChat === '__global__';
  const isChannel = curChat.startsWith('ch_');
  // const isDM      = !isGlobal && !isChannel;

  // resolve header info
  let headerName: string;
  let headerSub: string;
  let dotOnline = false;

  if (isGlobal) {
    headerName = '# global';
    headerSub  = `${onlineUsers.length} online`;
    dotOnline  = true;
  } else if (isChannel) {
    const ch   = channels.find(c => c.id === curChat);
    headerName = ch ? `# ${ch.name}` : '# channel';
    const onlineCount = ch
      ? ch.members.filter(m => onlineUsers.includes(m)).length
      : 0;
    headerSub = ch ? `${ch.members.length} members · ${onlineCount} online` : '';
    dotOnline = false;
  } else {
    // DM
    const online = onlineUsers.includes(curChat);
    headerName   = curChat;
    headerSub    = online ? 'online' : 'offline';
    dotOnline    = online;
  }

  return (
    <div className="chat-pane">
      <div className="chat-header">
        <div className={`chat-header-dot${dotOnline ? ' online' : ''}`} />
        <div className="chat-header-name">{headerName}</div>
        <div className="chat-header-sub">{headerSub}</div>
      </div>

      <div className="messages" ref={msgBoxRef}>
        {messages.length === 0 ? (
          <div className="messages-empty">no messages yet</div>
        ) : (
          messages.map((m, i) => {
            const own        = m.from === myUser;
            const showAuthor = isGlobal || isChannel || !own;
            return (
              <div key={m.id ?? i} className={`msg ${own ? 'own' : 'other'}`}>
                <div className="msg-meta">
                  {showAuthor && <span className="msg-author">{m.from}</span>}
                  <span className="msg-time">{m.ts}</span>
                  {own && m.id != null && (
                    <button
                      className="msg-del-btn"
                      title="Delete message"
                      onClick={() => onDeleteMessage(m.id!, curChat)}
                    >×</button>
                  )}
                </div>
                <div className="msg-bubble">{m.content}</div>
              </div>
            );
          })
        )}
      </div>

      <div className="input-row">
        <div className="prompt-label">&gt;</div>
        <textarea
          ref={textareaRef}
          className="msg-input"
          rows={1}
          placeholder="type a message..."
          value={text}
          onChange={e => setText(e.target.value)}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
        />
        <button className="send-btn" onClick={sendMsg}>send</button>
      </div>
    </div>
  );
}
