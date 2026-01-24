'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { X, Send, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getSessions, copyToSession, type CaptureMode } from '@/lib/api';
import { getProviderDisplayName, getRepoNameFromSession, getSessionDisplayName } from '@/lib/utils';
import type { Session, SessionWithSnapshot } from '@agent-command/schema';

interface SendToSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  sourceSession: Session;
  initialTargetSessionId?: string;
}

export function SendToSessionDialog({
  isOpen,
  onClose,
  sourceSession,
  initialTargetSessionId,
}: SendToSessionDialogProps) {
  const [targetSessionId, setTargetSessionId] = useState<string>('');
  const [mode, setMode] = useState<CaptureMode>('visible');
  const [lastNLines, setLastNLines] = useState<number>(20);
  const [lineStart, setLineStart] = useState<number>(0);
  const [lineEnd, setLineEnd] = useState<number>(200);
  const [prependText, setPrependText] = useState<string>('');
  const [appendText, setAppendText] = useState<string>('');
  const [stripAnsi, setStripAnsi] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

  // Fetch available sessions (excluding source)
  const { data: sessionsData, isLoading: loadingSessions } = useQuery({
    queryKey: ['sessions', 'active'],
    queryFn: () => getSessions({ status: 'RUNNING,IDLE,WAITING_FOR_INPUT' }),
    enabled: isOpen,
  });

  const availableSessions = (sessionsData?.sessions || []).filter(
    (s) => s.id !== sourceSession.id
  );
  const sourceGroupId = sourceSession.group_id || null;
  const sortedSessions = [...availableSessions].sort((a, b) => {
    const aGroup = a.group_id || null;
    const bGroup = b.group_id || null;
    const aScore = aGroup === sourceGroupId ? 0 : 1;
    const bScore = bGroup === sourceGroupId ? 0 : 1;
    if (aScore !== bScore) return aScore - bScore;
    return getSessionDisplayName(a).localeCompare(getSessionDisplayName(b));
  });

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setTargetSessionId(initialTargetSessionId || '');
      setMode('visible');
      setLastNLines(20);
      setLineStart(0);
      setLineEnd(200);
      setPrependText('');
      setAppendText('');
      setStripAnsi(true);
      setError(null);
      setSuccess(false);
    }
  }, [isOpen, initialTargetSessionId]);

  const mutation = useMutation({
    mutationFn: () =>
      copyToSession(sourceSession.id, {
        target_session_id: targetSessionId,
        mode,
        line_start: mode === 'range' ? lineStart : undefined,
        line_end: mode === 'range' ? lineEnd : undefined,
        last_n_lines: mode === 'last_n' ? lastNLines : undefined,
        prepend_text: prependText || undefined,
        append_text: appendText || undefined,
        strip_ansi: stripAnsi,
      }),
    onSuccess: (result) => {
      setSuccess(true);
      setError(null);
      // Auto-close after success
      setTimeout(() => {
        onClose();
      }, 1500);
    },
    onError: (err: Error) => {
      setError(err.message);
      setSuccess(false);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!targetSessionId) {
      setError('Please select a target session');
      return;
    }

    mutation.mutate();
  };

  const isLoading = mutation.isPending;

  // Format session display name
  const formatSessionName = (session: SessionWithSnapshot) => {
    const title = getSessionDisplayName(session);
    const provider = getProviderDisplayName(session.provider);
    const repo = getRepoNameFromSession(session);
    const branch = session.git_branch ? ` · ${session.git_branch}` : '';
    const repoLabel = repo ? ` · ${repo}` : '';
    return `${title}${repoLabel}${branch} [${provider}]`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg shadow-lg w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Copy className="h-5 w-5" />
            Send Content to Session
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded"
            disabled={isLoading}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          Copy content from{' '}
          <span className="font-medium text-foreground">
            {sourceSession.title || 'this session'}
          </span>{' '}
          to another session with optional instructions.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Target Session */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Target Session
            </label>
            <select
              value={targetSessionId}
              onChange={(e) => setTargetSessionId(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-background"
              disabled={isLoading || loadingSessions}
            >
              <option value="">Select a session...</option>
              {sortedSessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {formatSessionName(session)}
                </option>
              ))}
            </select>
            {availableSessions.length === 0 && !loadingSessions && (
              <p className="text-xs text-muted-foreground mt-1">
                No other active sessions found
              </p>
            )}
          </div>

          {/* Capture Mode */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Capture Mode
            </label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as CaptureMode)}
              className="w-full px-3 py-2 border rounded-md bg-background"
              disabled={isLoading}
            >
              <option value="visible">Visible content only</option>
              <option value="last_n">Last N lines</option>
              <option value="range">Line range</option>
              <option value="full">Full scrollback</option>
            </select>
          </div>

          {/* Mode-specific options */}
          {mode === 'last_n' && (
            <div>
              <label className="block text-sm font-medium mb-1">
                Number of Lines
              </label>
              <input
                type="number"
                value={lastNLines}
                onChange={(e) => setLastNLines(parseInt(e.target.value) || 20)}
                className="w-full px-3 py-2 border rounded-md bg-background"
                min={1}
                max={10000}
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Tip: 20–50 lines is usually enough for context.
              </p>
            </div>
          )}

          {mode === 'range' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Start Line
                </label>
                <input
                  type="number"
                  value={lineStart}
                  onChange={(e) => setLineStart(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                  min={0}
                  disabled={isLoading}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  End Line
                </label>
                <input
                  type="number"
                  value={lineEnd}
                  onChange={(e) => setLineEnd(parseInt(e.target.value) || 200)}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                  min={1}
                  disabled={isLoading}
                />
              </div>
            </div>
          )}

          {/* Prepend Text */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Prepend Instructions (optional)
            </label>
            <textarea
              value={prependText}
              onChange={(e) => setPrependText(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-background resize-none"
              rows={2}
              placeholder="e.g., Here's the plan from the Claude session:"
              disabled={isLoading}
            />
          </div>

          {/* Append Text */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Append Instructions (optional)
            </label>
            <textarea
              value={appendText}
              onChange={(e) => setAppendText(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-background resize-none"
              rows={2}
              placeholder="e.g., Implement step 3 from the plan above."
              disabled={isLoading}
            />
          </div>

          {/* Strip ANSI */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="strip-ansi"
              checked={stripAnsi}
              onChange={(e) => setStripAnsi(e.target.checked)}
              className="rounded border-gray-300"
              disabled={isLoading}
            />
            <label htmlFor="strip-ansi" className="text-sm">
              Strip ANSI escape codes (recommended)
            </label>
          </div>

          {/* Error */}
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
              {error}
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="text-sm text-green-600 bg-green-100 dark:bg-green-900/30 px-3 py-2 rounded">
              Content sent successfully!
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !targetSessionId}
              className="flex items-center gap-2"
            >
              <Send className="h-4 w-4" />
              {isLoading ? 'Sending...' : 'Send to Session'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
