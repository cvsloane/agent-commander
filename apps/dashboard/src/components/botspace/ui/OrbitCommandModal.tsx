'use client';

import { useState, useRef, useEffect } from 'react';

interface OrbitCommandModalProps {
  open: boolean;
  target: { x: number; y: number } | null;
  sessionName: string;
  sessionColor: string;
  onSend: (text: string) => Promise<boolean>;
  onClose: () => void;
}

export function OrbitCommandModal({
  open,
  target,
  sessionName,
  sessionColor,
  onSend,
  onClose,
}: OrbitCommandModalProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setText('');
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open || !target) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sending) return;

    setSending(true);
    const success = await onSend(text.trim());
    setSending(false);

    if (success) {
      onClose();
    }
  };

  // Position near the orbit but not overlapping
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(target.x + 20, window.innerWidth - 350),
    top: Math.max(target.y - 60, 20),
  };

  return (
    <>
      <div className="orbit-command-backdrop" onClick={onClose} />
      <div className="orbit-command-modal" style={style}>
        <div className="orbit-command-header">
          <span className="orbit-command-dot" style={{ background: sessionColor }} />
          <span className="orbit-command-name">{sessionName}</span>
        </div>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            className="orbit-command-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Enter command..."
            disabled={sending}
          />
          <div className="orbit-command-hint">
            <kbd>Enter</kbd> to send | <kbd>Esc</kbd> to close
          </div>
        </form>
      </div>

      <style jsx>{`
        .orbit-command-backdrop {
          position: fixed;
          inset: 0;
          z-index: calc(var(--viz-z-modal, 100) - 1);
        }

        .orbit-command-modal {
          background: var(--bs-surface, #24273A);
          border: 1px solid rgba(245, 166, 35, 0.4);
          border-radius: 10px;
          padding: 12px;
          min-width: 300px;
          z-index: var(--viz-z-modal, 100);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        }

        .orbit-command-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
        }

        .orbit-command-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
        }

        .orbit-command-name {
          color: var(--bs-text, #CAD3F5);
          font-size: 14px;
          font-weight: 500;
        }

        .orbit-command-input {
          width: 100%;
          background: rgba(26, 27, 38, 0.8);
          border: 1px solid rgba(245, 166, 35, 0.3);
          border-radius: 6px;
          padding: 10px 12px;
          color: var(--bs-text, #CAD3F5);
          font-size: 14px;
          font-family: var(--viz-font-mono, monospace);
        }

        .orbit-command-input:focus {
          outline: none;
          border-color: var(--bs-primary, #F5A623);
          box-shadow: 0 0 0 2px rgba(245, 166, 35, 0.2);
        }

        .orbit-command-input::placeholder {
          color: var(--bs-text-dim, #6E738D);
        }

        .orbit-command-input:disabled {
          opacity: 0.6;
        }

        .orbit-command-hint {
          margin-top: 8px;
          color: var(--bs-text-dim, #6E738D);
          font-size: 11px;
          text-align: center;
        }

        .orbit-command-hint kbd {
          background: rgba(245, 166, 35, 0.15);
          color: var(--bs-primary, #F5A623);
          padding: 2px 5px;
          border-radius: 3px;
          font-family: inherit;
          font-size: 10px;
        }
      `}</style>
    </>
  );
}
