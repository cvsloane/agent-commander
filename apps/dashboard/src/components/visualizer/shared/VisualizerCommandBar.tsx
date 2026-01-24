'use client';

import { useCallback, useMemo, useState } from 'react';
import type { SessionWithSnapshot } from '@agent-command/schema';
import { sendCommand } from '@/lib/api';
import { cn } from '@/lib/utils';

interface VisualizerCommandBarProps {
  sessions: SessionWithSnapshot[];
  selectedSessionId: string | null;
  className?: string;
}

type PromptStatus = { type: 'idle' | 'success' | 'error'; message?: string };

export function VisualizerCommandBar({
  sessions,
  selectedSessionId,
  className,
}: VisualizerCommandBarProps) {
  const [prompt, setPrompt] = useState('');
  const [promptStatus, setPromptStatus] = useState<PromptStatus>({ type: 'idle' });
  const [sendToSession, setSendToSession] = useState(true);
  const [isSending, setIsSending] = useState(false);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );

  const handleSend = useCallback(async () => {
    if (!selectedSessionId) {
      setPromptStatus({ type: 'error', message: 'Select a session' });
      return;
    }
    if (!sendToSession) {
      setPromptStatus({ type: 'error', message: 'Send disabled' });
      return;
    }
    const trimmed = prompt.trim();
    if (!trimmed) return;

    setIsSending(true);
    try {
      await sendCommand(selectedSessionId, {
        type: 'send_input',
        payload: { text: trimmed, enter: true },
      });
      setPrompt('');
      setPromptStatus({ type: 'success', message: 'Sent' });
    } catch {
      setPromptStatus({ type: 'error', message: 'Failed to send' });
    } finally {
      setIsSending(false);
      setTimeout(() => setPromptStatus({ type: 'idle' }), 2000);
    }
  }, [prompt, selectedSessionId, sendToSession]);

  const handleInterrupt = useCallback(async () => {
    if (!selectedSessionId) return;
    try {
      await sendCommand(selectedSessionId, { type: 'interrupt', payload: {} });
    } catch {
      // Ignore failed interrupt attempts
    }
  }, [selectedSessionId]);

  return (
    <div id="prompt-container" className={cn('visualizer-command-bar', className)}>
      <form
        id="prompt-form"
        onSubmit={(event) => {
          event.preventDefault();
          handleSend();
        }}
      >
        <div className="input-wrapper">
          <textarea
            id="prompt-input"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={selectedSessionId ? 'Prompt…' : 'Select a session'}
            disabled={!selectedSessionId || isSending}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
          />
        </div>
        <button type="submit" id="prompt-submit" disabled={!selectedSessionId || isSending}>
          <span className="btn-icon">↗</span> Send
        </button>
        <button
          type="button"
          id="prompt-cancel"
          onClick={handleInterrupt}
          disabled={!selectedSessionId}
        >
          <span className="btn-icon">◼</span> Stop
        </button>
      </form>
      <div id="prompt-options">
        <label className="send-toggle">
          <input
            type="checkbox"
            checked={sendToSession}
            onChange={(event) => setSendToSession(event.target.checked)}
          />
          Send to session
        </label>
        <span id="prompt-target">
          {selectedSession ? (
            <>
              <span className="target-dot" style={{ background: 'var(--viz-accent-primary)' }} />
              {selectedSession.title || selectedSession.cwd?.split('/').pop() || 'Session'}
            </>
          ) : (
            'No session'
          )}
        </span>
        <span
          id="prompt-status"
          className={
            promptStatus.type === 'success'
              ? 'success'
              : promptStatus.type === 'error'
                ? 'error'
                : ''
          }
        >
          {promptStatus.message || ''}
        </span>
      </div>
    </div>
  );
}
