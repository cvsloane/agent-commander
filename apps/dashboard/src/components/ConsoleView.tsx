'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import AnsiToHtml from 'ansi-to-html';
import type { ServerToUIMessage } from '@agent-command/schema';
import { sendCommand } from '@/lib/api';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { VirtualKeyboard, SelectionPopup, TerminalContextMenu } from '@/components/mobile';
import { VoiceInputButton } from '@/components/VoiceInputButton';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useClipboard, stripAnsi as stripAnsiUtil, getLastNLines } from '@/hooks/useClipboard';

interface ConsoleViewProps {
  sessionId: string;
  snapshot: string | null;
  paneId?: string;
  status?: string;
  provider?: string | null;
}

const TUI_PROVIDERS = new Set([
  'claude_code',
  'codex',
  'gemini_cli',
  'cursor',
  'aider',
  'opencode',
  'continue',
  'shell',
  'unknown',
]);

const MAX_CONSOLE_BUFFER_CHARS = 120_000;
const MAX_CONSOLE_BUFFER_LINES = 1200;
const MAX_CONSOLE_RENDER_CHARS = 60_000;

function trimConsoleContent(value: string): string {
  if (!value) return '';
  let trimmed = value;
  if (trimmed.length > MAX_CONSOLE_BUFFER_CHARS) {
    trimmed = trimmed.slice(trimmed.length - MAX_CONSOLE_BUFFER_CHARS);
  }
  const lines = trimmed.split('\n');
  if (lines.length > MAX_CONSOLE_BUFFER_LINES) {
    trimmed = lines.slice(-MAX_CONSOLE_BUFFER_LINES).join('\n');
  }
  return trimmed;
}

export function ConsoleView({ sessionId, snapshot, paneId, status, provider }: ConsoleViewProps) {
  const [content, setContent] = useState(() => trimConsoleContent(snapshot || ''));
  const [streaming, setStreaming] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [autoStream, setAutoStream] = useState(true);
  const [inputText, setInputText] = useState('');
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [renderedContent, setRenderedContent] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const consoleRef = useRef<HTMLPreElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const startStreamRef = useRef<() => void>(() => {});
  const useSnapshotStream = provider ? TUI_PROVIDERS.has(provider) : false;
  const streamingSnapshot = useSnapshotStream && streaming;
  const isMobile = useIsMobile();
  const { copyToClipboard, readFromClipboard } = useClipboard();

  // Track selection changes for copy button state
  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      setHasSelection(!!selection && !selection.isCollapsed && !!selection.toString().trim());
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);

  // Handle console chunks
  const handleMessage = useCallback((message: ServerToUIMessage) => {
    if (message.type === 'snapshots.updated') {
      const payload = message.payload as {
        session_id: string;
        capture_text: string;
      };
      if (payload.session_id === sessionId && streamingSnapshot) {
        setContent(trimConsoleContent(payload.capture_text));
      }
      return;
    }

    if (useSnapshotStream) return;
    if (message.type === 'console.chunk') {
      const payload = message.payload as {
        subscription_id: string;
        session_id: string;
        data: string;
      };

      if (payload.session_id === sessionId) {
        if (!payload.data) return;
        setContent((prev) => trimConsoleContent(prev + payload.data));
      }
    }
  }, [sessionId, streamingSnapshot, useSnapshotStream]);

  useWebSocket(
    streamingSnapshot
      ? [{ type: 'snapshots', filter: { session_id: sessionId } }]
      : streaming && subscriptionId
        ? [{ type: 'console', filter: { subscription_id: subscriptionId, session_id: sessionId } }]
        : [],
    handleMessage
  );

  const shouldAutoStream = autoStream && !!paneId && status !== 'DONE';

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryAttemptRef.current = 0;
  }, []);

  const scheduleRetry = useCallback(() => {
    if (!shouldAutoStream) return;
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
    }
    retryAttemptRef.current += 1;
    const delay = Math.min(30000, 1000 * Math.pow(2, retryAttemptRef.current - 1));
    retryTimerRef.current = window.setTimeout(() => {
      startStreamRef.current();
    }, delay);
  }, [shouldAutoStream]);

  useEffect(() => {
    if (useSnapshotStream || !streaming) {
      setContent(trimConsoleContent(snapshot || ''));
    }
  }, [snapshot, streaming, useSnapshotStream]);

  useEffect(() => {
    if (!shouldAutoStream) {
      clearRetry();
    }
  }, [shouldAutoStream, clearRetry]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [content, autoScroll]);

  const startStream = useCallback(async () => {
    if (!paneId) {
      setErrorMessage('Streaming is only available for tmux-backed sessions.');
      return;
    }

    const subId = crypto.randomUUID();
    setSubscriptionId(subId);

    try {
      await sendCommand(sessionId, {
        type: 'console.subscribe',
        payload: {
          subscription_id: subId,
          pane_id: paneId,
        },
      });
      setStreaming(true);
      setAutoStream(true);
      setErrorMessage(null);
      clearRetry();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start stream';
      setErrorMessage(message);
      setSubscriptionId(null);
      setStreaming(false);
      if (shouldAutoStream && /agent not connected/i.test(message)) {
        scheduleRetry();
      }
      console.error('Failed to start stream:', err);
    }
  }, [paneId, sessionId, clearRetry, scheduleRetry, shouldAutoStream]);

  useEffect(() => {
    startStreamRef.current = startStream;
  }, [startStream]);

  useEffect(() => {
    if (shouldAutoStream && !streaming) {
      startStream();
    }
  }, [shouldAutoStream, streaming, startStream]);

  const stopStream = useCallback(async () => {
    if (!subscriptionId) return;

    try {
      await sendCommand(sessionId, {
        type: 'console.unsubscribe',
        payload: {
          subscription_id: subscriptionId,
        },
      });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to stop stream');
      console.error('Failed to stop stream:', err);
    } finally {
      setStreaming(false);
      setSubscriptionId(null);
      setAutoStream(false);
      clearRetry();
    }
  }, [subscriptionId, sessionId, clearRetry]);

  useEffect(() => {
    return () => {
      if (subscriptionId) {
        sendCommand(sessionId, {
          type: 'console.unsubscribe',
          payload: { subscription_id: subscriptionId },
        }).catch(() => {});
      }
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [subscriptionId, sessionId]);

  const sendEnter = async () => {
    await sendCommand(sessionId, {
      type: 'send_keys',
      payload: {
        keys: ['Enter'],
      },
    });
  };

  const sendInput = async () => {
    if (!inputText.trim()) return;

    if (!streaming) {
      setContent((prev) =>
        trimConsoleContent(`${prev}${prev.endsWith('\n') ? '' : '\n'}${inputText}\n`)
      );
    }

    try {
      await sendCommand(sessionId, {
        type: 'send_input',
        payload: {
          text: inputText,
          enter: false,
        },
      });
      await sendEnter();
      setInputText('');
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to send input');
      console.error('Failed to send input:', err);
    }
  };

  const sendQuickInput = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    if (!streaming) {
      setContent((prev) =>
        trimConsoleContent(`${prev}${prev.endsWith('\n') ? '' : '\n'}${trimmed}\n`)
      );
    }

    try {
      await sendCommand(sessionId, {
        type: 'send_input',
        payload: {
          text: trimmed,
          enter: false,
        },
      });
      await sendEnter();
      setInputText('');
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to send input');
      console.error('Failed to send input:', err);
    }
  };

  const handleVoiceTranscript = useCallback((text: string) => {
    if (!text.trim()) return;
    setInputText((prev) => (prev ? `${prev} ${text}` : text));
  }, []);

  const sendInterrupt = async () => {
    try {
      await sendCommand(sessionId, {
        type: 'interrupt',
        payload: {},
      });
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to send interrupt');
      console.error('Failed to send interrupt:', err);
    }
  };

  // Virtual keyboard handler - sends raw key sequences
  const handleVirtualInput = useCallback(async (data: string) => {
    try {
      await sendCommand(sessionId, {
        type: 'send_input',
        payload: {
          text: data,
          enter: false, // Don't add Enter for escape sequences
        },
      });
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to send input');
      console.error('Failed to send virtual input:', err);
    }
  }, [sessionId]);

  // Clipboard handlers
  const handleCopy = useCallback(() => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      copyToClipboard(selection.toString());
    }
  }, [copyToClipboard]);

  const handleCopyLastLines = useCallback((lines: number) => {
    const cleanedContent = stripAnsiUtil(content);
    const lastLines = getLastNLines(cleanedContent, lines);
    copyToClipboard(lastLines);
  }, [content, copyToClipboard]);

  const handleCopyAll = useCallback(() => {
    const cleanedContent = stripAnsiUtil(content);
    copyToClipboard(cleanedContent);
  }, [content, copyToClipboard]);

  const handlePaste = useCallback(async (text?: string) => {
    const pasteText = text || await readFromClipboard();
    if (pasteText) {
      setInputText((prev) => prev + pasteText);
      inputRef.current?.focus();
    }
  }, [readFromClipboard]);

  const handleClear = useCallback(async () => {
    try {
      await sendCommand(sessionId, {
        type: 'send_input',
        payload: {
          text: '\x0c', // Ctrl+L
          enter: false,
        },
      });
    } catch (err) {
      console.error('Failed to send clear:', err);
    }
  }, [sessionId]);

  const handleSelectionCopy = useCallback((text: string) => {
    copyToClipboard(text);
  }, [copyToClipboard]);

  const ansi = useMemo(() => new AnsiToHtml({ escapeXML: true }), []);
  useEffect(() => {
    const displayText = content.length > MAX_CONSOLE_RENDER_CHARS
      ? content.slice(-MAX_CONSOLE_RENDER_CHARS)
      : content;
    let cancelled = false;
    const render = () => {
      if (cancelled) return;
      setRenderedContent(ansi.toHtml(displayText || 'No output yet'));
    };
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof win.requestIdleCallback === 'function') {
      const id = win.requestIdleCallback(render, { timeout: 200 });
      return () => {
        cancelled = true;
        if (typeof win.cancelIdleCallback === 'function') {
          win.cancelIdleCallback(id);
        }
      };
    }
    const id = window.setTimeout(render, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [ansi, content]);
  const stripAnsi = useCallback((value: string) => {
    return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
  }, []);
  const detectedPrompt = useMemo(() => {
    const cleaned = stripAnsi(content || '');
    const lines = cleaned.split('\n');
    if (lines.length === 0) return null;

    const recent = lines.slice(-60);
    const optionPattern = /^\s*(?:[❯>]\s*)?(\d+)\.\s+(.*)$/;

    let lastOptionIndex = -1;
    for (let i = recent.length - 1; i >= 0; i -= 1) {
      if (optionPattern.test(recent[i])) {
        lastOptionIndex = i;
        break;
      }
    }
    if (lastOptionIndex === -1) return null;

    // Find nearby prompt/question line
    const promptHints = [
      'do you want',
      'select an option',
      'choose an option',
      'proceed?',
      'esc to cancel',
    ];
    let question = '';
    for (let i = Math.max(0, lastOptionIndex - 8); i < Math.min(recent.length, lastOptionIndex + 4); i += 1) {
      const line = recent[i].trim();
      if (!line) continue;
      const lower = line.toLowerCase();
      if (promptHints.some((hint) => lower.includes(hint)) || line.endsWith('?')) {
        question = line;
        break;
      }
    }
    if (!question) return null;

    // Collect contiguous options around the last option line
    const options: Array<{ value: string; label: string }> = [];
    let start = lastOptionIndex;
    while (start - 1 >= 0 && optionPattern.test(recent[start - 1])) {
      start -= 1;
    }
    let end = lastOptionIndex;
    while (end + 1 < recent.length && optionPattern.test(recent[end + 1])) {
      end += 1;
    }
    for (let i = start; i <= end; i += 1) {
      const match = recent[i].match(optionPattern);
      if (match) {
        options.push({ value: match[1], label: match[2].trim() });
      }
    }

    if (options.length === 0) return null;
    return { question: question || 'Select an option', options };
  }, [content, stripAnsi]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b bg-muted/30">
        {streaming ? (
          <Button size="sm" variant="outline" onClick={stopStream}>
            Stop Stream
          </Button>
        ) : (
          <Button size="sm" onClick={startStream} disabled={!paneId}>
            Start Stream
          </Button>
        )}

        <Button
          size="sm"
          variant={autoStream ? 'default' : 'outline'}
          onClick={() => setAutoStream(!autoStream)}
          disabled={!paneId}
        >
          {autoStream ? 'Auto' : 'Auto Off'}
        </Button>

        <Button
          size="sm"
          variant={autoScroll ? 'default' : 'outline'}
          onClick={() => setAutoScroll(!autoScroll)}
        >
          {autoScroll ? 'Following' : 'Follow'}
        </Button>

        {streaming && (
          <div className="flex items-center gap-1 text-xs text-green-600">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            Live
          </div>
        )}

        <div className="flex-1" />

        <Button size="sm" variant="destructive" onClick={sendInterrupt}>
          Ctrl+C
        </Button>
      </div>
      {errorMessage && (
        <div className="px-3 py-2 text-sm text-destructive border-b">
          {errorMessage}
        </div>
      )}

      {/* Console output */}
      <pre
        ref={consoleRef}
        className={cn(
          'flex-1 overflow-y-auto overflow-x-hidden p-4 console-output bg-console relative',
          streaming && 'border-l-2 border-emerald-500 shadow-[inset_2px_0_0_rgba(16,185,129,0.35)]',
          isMobile && 'text-xs p-2'
        )}
      >
        <div
          className={cn(
            'console-html',
            'break-words whitespace-pre-wrap'
          )}
          dangerouslySetInnerHTML={{ __html: renderedContent }}
        />
      </pre>

      {/* Mobile clipboard components */}
      {isMobile && (
        <>
          <SelectionPopup
            containerRef={consoleRef as React.RefObject<HTMLElement>}
            onCopy={handleSelectionCopy}
          />
          <TerminalContextMenu
            containerRef={consoleRef as React.RefObject<HTMLElement>}
            onCopySelection={handleCopy}
            onCopyLastLines={handleCopyLastLines}
            onCopyAll={handleCopyAll}
            onPaste={() => handlePaste()}
            onClear={handleClear}
          />
        </>
      )}

      {detectedPrompt && (
        <div className="px-3 py-2 border-t bg-muted/20">
          <div className="text-xs text-muted-foreground mb-2">
            {detectedPrompt.question}
          </div>
          <div className="flex flex-wrap gap-2">
            {detectedPrompt.options.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant="outline"
                onClick={() => sendQuickInput(option.value)}
              >
                {option.value}. {option.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="flex items-center gap-2 p-2 border-t">
        <textarea
          ref={inputRef}
          rows={1}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key.toLowerCase() === 'j') {
              e.preventDefault();
              const target = e.currentTarget;
              const start = target.selectionStart;
              const end = target.selectionEnd;
              const next = `${inputText.slice(0, start)}\n${inputText.slice(end)}`;
              setInputText(next);
              requestAnimationFrame(() => {
                target.selectionStart = target.selectionEnd = start + 1;
              });
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
              e.preventDefault();
              sendInput();
            }
          }}
          placeholder="Type input (Enter to send, Shift+Enter/Ctrl+J for newline)..."
          className={cn(
            'flex-1 px-3 bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-ring resize-none',
            isMobile ? 'py-3 text-base min-h-[44px]' : 'py-2 text-sm min-h-[38px]'
          )}
        />
        <Button
          onClick={sendInput}
          className={cn(isMobile && 'min-h-[44px] min-w-[44px]')}
        >
          Send
        </Button>
        {!isMobile && (
          <VoiceInputButton
            onTranscript={handleVoiceTranscript}
            disabled={!paneId || status === 'DONE'}
            className="self-center"
          />
        )}
      </div>

      {/* Virtual keyboard for mobile */}
      <VirtualKeyboard
        onInput={handleVirtualInput}
        onInterrupt={sendInterrupt}
        onCopy={handleCopy}
        onPaste={handlePaste}
        canCopy={hasSelection}
        autoShowOnMobile={isMobile}
      />
    </div>
  );
}
