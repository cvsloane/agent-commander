'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { ChevronDown, Forward, Loader2, MessageSquarePlus, Send } from 'lucide-react';
import type { CommandRequest, Session } from '@agent-command/schema';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useIsMobile } from '@/hooks/useIsMobile';
import { sendCommand } from '@/lib/api';
import { getSessionDisplayName } from '@/lib/utils';
import { useFleetStore } from '@/stores/fleet';
import { useSettingsStore } from '@/stores/settings';

type PromptSender = (sessionId: string, command: CommandRequest) => Promise<unknown>;
const EMPTY_PROMPT_HISTORY: string[] = [];

export async function sendPromptToSession(
  sessionId: string,
  prompt: string,
  sender: PromptSender = sendCommand
): Promise<void> {
  const normalized = prompt.trim();
  if (!normalized) return;
  await sender(sessionId, {
    type: 'send_input',
    payload: { text: `${normalized}\n`, enter: false },
  });
}

export function recallPromptHistory(
  history: string[],
  currentIndex: number
): { value: string; index: number } | null {
  if (history.length === 0) return null;
  const index = Math.min(currentIndex + 1, history.length - 1);
  return { value: history[index]!, index };
}

export interface PromptComposerHandle {
  openAndFocus: () => void;
}

interface PromptComposerProps {
  session: Session;
  readOnly?: boolean;
  hideCollapsed?: boolean;
  onSendToOtherSession?: (targetSessionId: string) => void;
}

export const PromptComposer = forwardRef<PromptComposerHandle, PromptComposerProps>(
  function PromptComposer(
    { session, readOnly = false, hideCollapsed = false, onSendToOtherSession },
    ref
  ) {
    const [expanded, setExpanded] = useState(false);
    const [prompt, setPrompt] = useState('');
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [targetSessionId, setTargetSessionId] = useState('');
    const [sending, setSending] = useState(false);
    const [sendState, setSendState] = useState<{
      type: 'success' | 'error';
      message: string;
    } | null>(null);
    const [focusRequest, setFocusRequest] = useState(0);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const isMobile = useIsMobile(768);
    const history = useSettingsStore(
      (state) => state.promptHistoryBySession[session.id] ?? EMPTY_PROMPT_HISTORY
    );
    const addPromptHistory = useSettingsStore((state) => state.addPromptHistory);
    const rosterByHost = useFleetStore((state) => state.rosterByHost);
    const otherSessions = useMemo(() => [
      ...new Map(
        Object.values(rosterByHost)
          .flat()
          .filter((candidate) => candidate.id !== session.id && !candidate.archived_at)
          .map((candidate) => [candidate.id, candidate])
      ).values(),
    ].sort((left, right) => (
      getSessionDisplayName(left).localeCompare(getSessionDisplayName(right))
    )), [rosterByHost, session.id]);

    useImperativeHandle(ref, () => ({
      openAndFocus: () => {
        setExpanded(true);
        setFocusRequest((request) => request + 1);
      },
    }), []);

    useEffect(() => {
      if (!expanded || focusRequest === 0) return;
      textareaRef.current?.focus({ preventScroll: true });
    }, [expanded, focusRequest]);

    useEffect(() => {
      setExpanded(false);
      setPrompt('');
      setHistoryIndex(-1);
      setTargetSessionId('');
      setSendState(null);
    }, [session.id]);

    const submit = async (event?: FormEvent) => {
      event?.preventDefault();
      const normalized = prompt.trim();
      if (!normalized || sending || readOnly) return;
      setSending(true);
      setSendState(null);
      try {
        await sendPromptToSession(session.id, normalized);
        addPromptHistory(session.id, normalized);
        setPrompt('');
        setHistoryIndex(-1);
        setSendState({ type: 'success', message: 'Prompt sent.' });
        textareaRef.current?.focus({ preventScroll: true });
      } catch (caught) {
        setSendState({
          type: 'error',
          message: caught instanceof Error ? caught.message : 'Could not send the prompt.',
        });
      } finally {
        setSending(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void submit();
        return;
      }
      if (
        event.key !== 'ArrowUp'
        || isMobile
        || event.currentTarget.selectionStart !== 0
        || event.currentTarget.selectionEnd !== 0
      ) {
        return;
      }
      const recalled = recallPromptHistory(history, historyIndex);
      if (!recalled) return;
      event.preventDefault();
      setPrompt(recalled.value);
      setHistoryIndex(recalled.index);
      requestAnimationFrame(() => {
        textareaRef.current?.setSelectionRange(0, 0);
      });
    };

    if (!expanded) {
      if (hideCollapsed) return null;
      const readOnlyHintId = `prompt-composer-readonly-${session.id}`;
      return (
        <div
          className="shrink-0 border-t bg-background px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]"
          data-terminal-bottom-controls
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-full justify-start gap-2 text-muted-foreground"
            onClick={() => setExpanded(true)}
            disabled={readOnly}
            aria-expanded="false"
            aria-controls={`prompt-composer-${session.id}`}
            aria-describedby={readOnly ? readOnlyHintId : undefined}
          >
            <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
            Send a prompt
          </Button>
          {readOnly && (
            <p id={readOnlyHintId} className="px-2 pt-1 text-xs text-amber-700 dark:text-amber-400">
              Read-only — take control to type
            </p>
          )}
        </div>
      );
    }

    return (
      <form
        id={`prompt-composer-${session.id}`}
        className="shrink-0 space-y-2 border-t bg-background px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        onSubmit={(event) => void submit(event)}
        data-testid="prompt-composer"
        data-terminal-bottom-controls
      >
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`prompt-composer-input-${session.id}`} className="text-xs font-semibold">
            Prompt {getSessionDisplayName(session)}
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setExpanded(false)}
            aria-label="Collapse prompt composer"
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            Collapse
          </Button>
        </div>
        <Textarea
          ref={textareaRef}
          id={`prompt-composer-input-${session.id}`}
          value={prompt}
          disabled={readOnly}
          onChange={(event) => {
            setPrompt(event.target.value);
            setHistoryIndex(-1);
            setSendState(null);
          }}
          onKeyDown={handleKeyDown}
          rows={3}
          placeholder="Type a prompt… (Ctrl/⌘ + Enter to send)"
          className="min-h-[72px] resize-y"
          data-prompt-composer-session={session.id}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {onSendToOtherSession && otherSessions.length > 0 && (
            <div className="flex min-w-0 flex-1 gap-1.5">
              <select
                value={targetSessionId}
                disabled={readOnly}
                onChange={(event) => setTargetSessionId(event.target.value)}
                className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
                aria-label="Other session target"
              >
                <option value="">Other session…</option>
                {otherSessions.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {getSessionDisplayName(candidate)}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                disabled={readOnly || !targetSessionId}
                onClick={() => targetSessionId && onSendToOtherSession(targetSessionId)}
              >
                <Forward className="h-3.5 w-3.5" aria-hidden="true" />
                Send to
              </Button>
            </div>
          )}
          <Button
            type="submit"
            size="sm"
            className="h-8 gap-1.5 sm:ml-auto"
            disabled={readOnly || !prompt.trim() || sending}
          >
            {sending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
            Send prompt
          </Button>
        </div>
        {readOnly && (
          <p className="text-xs text-amber-700 dark:text-amber-400" role="status">
            Read-only — take control to type
          </p>
        )}
        <p
          className={sendState?.type === 'error' ? 'text-xs text-destructive' : 'text-xs text-emerald-700 dark:text-emerald-400'}
          role={sendState?.type === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {sendState?.message}
        </p>
      </form>
    );
  }
);
