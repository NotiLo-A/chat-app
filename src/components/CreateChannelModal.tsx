import { useState, type KeyboardEvent } from 'react';

interface CreateChannelModalProps {
  openedDMs: string[];
  onConfirm: (name: string, members: string[]) => void;
  onClose: () => void;
}

export function CreateChannelModal({ openedDMs, onConfirm, onClose }: CreateChannelModalProps) {
  const [name,    setName]    = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error,   setError]   = useState('');

  const toggle = (u: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(u) ? next.delete(u) : next.add(u);
      return next;
    });
  };

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Channel name is required.'); return; }
    if (selected.size === 0) { setError('Select at least one member.'); return; }
    onConfirm(trimmed, [...selected]);
  };

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') handleCreate();
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} onKeyDown={handleKey}>
        <div className="modal-title">new channel</div>

        <div className="field">
          <label>Channel name</label>
          <input
            type="text"
            placeholder="e.g. project-alpha"
            value={name}
            autoFocus
            onChange={e => { setName(e.target.value); setError(''); }}
          />
        </div>

        <div className="modal-members-label">
          <span>add members</span>
          <span className="modal-members-count">{selected.size} selected</span>
        </div>

        {openedDMs.length === 0 ? (
          <div className="modal-no-dms">open a DM first to add members</div>
        ) : (
          <div className="modal-member-list">
            {openedDMs.map(u => (
              <div
                key={u}
                className={`modal-member-item${selected.has(u) ? ' selected' : ''}`}
                onClick={() => toggle(u)}
              >
                <div className="modal-member-check">
                  {selected.has(u) ? '✓' : ''}
                </div>
                <div className="modal-member-name">{u}</div>
              </div>
            ))}
          </div>
        )}

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-actions">
          <button className="modal-btn-cancel" onClick={onClose}>cancel</button>
          <button className="modal-btn-create" onClick={handleCreate}>
            -- create --
          </button>
        </div>
      </div>
    </div>
  );
}
