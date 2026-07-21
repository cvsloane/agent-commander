'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Bell, MoreHorizontal, Plus, Radio, X } from 'lucide-react';
import type { Session } from '@agent-command/schema';
import { Button } from '@/components/ui/button';
import { useTmuxHostTopology } from '@/hooks/useTmuxTopology';
import { useTmuxCommandResults } from '@/hooks/useTmuxCommandResults';
import { cn } from '@/lib/utils';
import { useNotifications } from '@/stores/notifications';
import type { TmuxWindowTopologyView } from '@/stores/tmuxTopology';
import { registerPendingTmuxCommand } from '@/stores/tmuxCommands';
import { runTmuxWindowAction, type TmuxWindowAction } from './windowActions';

interface TmuxWindowStripProps {
  session: Session;
  className?: string;
  onSelectSession?: (sessionId: string) => void;
}

export function getWindowViewerSessionId(window: TmuxWindowTopologyView): string | null {
  return window.panes.find((pane) => pane.active && pane.sessionId)?.sessionId
    ?? window.panes.find((pane) => pane.sessionId)?.sessionId
    ?? null;
}

export function getAdjacentTmuxWindow(
  windows: TmuxWindowTopologyView[],
  direction: 'previous' | 'next'
): TmuxWindowTopologyView | null {
  if (windows.length < 2) return null;
  const currentIndex = Math.max(0, windows.findIndex((window) => window.active));
  const offset = direction === 'next' ? 1 : -1;
  return windows[(currentIndex + offset + windows.length) % windows.length] ?? null;
}

function sessionIdentity(session: Session) {
  const tmux = session.metadata?.tmux;
  const targetIndexes = session.tmux_target?.match(/:(\d+)(?:\.(\d+))?$/);
  const windowIndex =
    session.tmux_window_index ?? tmux?.window_index ?? Number(targetIndexes?.[1] ?? 0);
  return {
    sessionName:
      session.tmux_session_name ||
      tmux?.session_name ||
      session.tmux_target?.split(':')[0] ||
      'tmux',
    windowIndex,
    paneIndex: session.tmux_pane_index ?? tmux?.pane_index ?? Number(targetIndexes?.[2] ?? 0),
    windowName: tmux?.window_name || `window ${windowIndex}`,
  };
}

function fallbackWindow(session: Session): TmuxWindowTopologyView {
  const identity = sessionIdentity(session);
  return {
    windowIndex: identity.windowIndex,
    windowName: identity.windowName,
    active: true,
    zoomed: false,
    layout: '',
    bell: false,
    activity: false,
    panes: [
      {
        paneId: session.tmux_pane_id || session.id,
        paneIndex: identity.paneIndex,
        active: true,
        title: session.title || '',
        currentCommand: session.metadata?.tmux?.current_command || '',
        currentPath: session.cwd || '',
        sessionId: session.id,
        sessionStatus: session.status,
        sessionTitle: session.title,
      },
    ],
  };
}

function optimisticWindows(
  windows: TmuxWindowTopologyView[],
  action: TmuxWindowAction
): TmuxWindowTopologyView[] {
  switch (action.type) {
    case 'select':
      return windows.map((window) => ({
        ...window,
        active: window.windowIndex === action.windowIndex,
      }));
    case 'rename':
      return windows.map((window) =>
        window.windowIndex === action.windowIndex ? { ...window, windowName: action.name } : window
      );
    case 'close':
      return windows.filter((window) => window.windowIndex !== action.windowIndex);
    case 'new': {
      const windowIndex = Math.max(-1, ...windows.map((window) => window.windowIndex)) + 1;
      return [
        ...windows.map((window) => ({ ...window, active: false })),
        {
          windowIndex,
          windowName: 'new',
          active: true,
          zoomed: false,
          layout: '',
          bell: false,
          activity: false,
          panes: [],
        },
      ];
    }
  }
}

export function TmuxWindowStrip({ session, className, onSelectSession }: TmuxWindowStripProps) {
  const identity = useMemo(() => sessionIdentity(session), [session]);
  const hostTopology = useTmuxHostTopology(session.host_id);
  const topologySession = hostTopology?.sessions.find(
    (candidate) => candidate.sessionName === identity.sessionName
  );
  const sourceWindows = useMemo(() => {
    const windows = topologySession?.windows ?? [fallbackWindow(session)];
    if (hostTopology?.source === 'topology') return windows;
    return windows.map((window) => ({
      ...window,
      active: window.windowIndex === identity.windowIndex,
      panes: window.panes.map((pane) => ({
        ...pane,
        active: pane.sessionId === session.id,
      })),
    }));
  }, [hostTopology?.source, identity.windowIndex, session, topologySession?.windows]);
  const [windows, setWindows] = useState(sourceWindows);
  const [contextWindowIndex, setContextWindowIndex] = useState<number | null>(null);
  const [editingWindowIndex, setEditingWindowIndex] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [pending, setPending] = useState(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const tablistRef = useRef<HTMLDivElement>(null);
  const selectWindowRef = useRef<(window: TmuxWindowTopologyView) => void>(() => undefined);
  const notifications = useNotifications();
  useTmuxCommandResults();

  useEffect(() => {
    setWindows(sourceWindows);
  }, [sourceWindows]);

  useEffect(() => {
    const activeTab = tablistRef.current?.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]'
    );
    activeTab?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [windows]);

  useEffect(
    () => () => {
      if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
    },
    []
  );

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const dispatchAction = async (action: TmuxWindowAction) => {
    if (pending) return;
    const previous = windows;
    const rollback = () => {
      setWindows(previous);
      if (action.type !== 'select') return;
      const previousWindow = previous.find((window) => window.active);
      const previousSessionId = previousWindow && getWindowViewerSessionId(previousWindow);
      if (previousSessionId) onSelectSession?.(previousSessionId);
    };
    setPending(true);
    try {
      await runTmuxWindowAction({
        sessionId: session.id,
        windowCount: windows.length,
        windowSource: hostTopology?.source ?? 'roster',
        action,
        optimistic: () => setWindows(optimisticWindows(windows, action)),
        rollback,
        onDispatched: (cmdId) => {
          const reconciliation = registerPendingTmuxCommand({
            cmdId,
            sessionId: session.id,
            failureTitle: 'tmux command failed',
            rollback,
          });
          if (reconciliation && !reconciliation.ok) {
            throw new Error(reconciliation.message);
          }
        },
      });
    } catch (error) {
      notifications.error(
        'tmux command failed',
        error instanceof Error ? error.message : 'The window change could not be applied.',
        { sessionId: session.id }
      );
    } finally {
      setPending(false);
    }
  };

  const selectWindow = (window: TmuxWindowTopologyView) => {
    void dispatchAction({ type: 'select', windowIndex: window.windowIndex });
    const nextSessionId = getWindowViewerSessionId(window);
    if (nextSessionId) onSelectSession?.(nextSessionId);
  };
  selectWindowRef.current = selectWindow;

  useEffect(() => {
    const handleTerminalSwipe = (event: Event) => {
      const detail = (event as CustomEvent<{
        direction?: 'previous' | 'next';
        sessionId?: string;
      }>).detail;
      if (detail?.sessionId !== session.id || !detail.direction) return;
      const nextWindow = getAdjacentTmuxWindow(windows, detail.direction);
      if (nextWindow) selectWindowRef.current(nextWindow);
    };
    window.addEventListener('terminal-window-swipe', handleTerminalSwipe);
    return () => window.removeEventListener('terminal-window-swipe', handleTerminalSwipe);
  }, [session.id, windows]);

  const beginRename = (window: TmuxWindowTopologyView) => {
    setContextWindowIndex(null);
    setEditingWindowIndex(window.windowIndex);
    setRenameValue(window.windowName);
  };

  const commitRename = (window: TmuxWindowTopologyView) => {
    const name = renameValue.trim();
    setEditingWindowIndex(null);
    if (!name || name === window.windowName) return;
    void dispatchAction({ type: 'rename', windowIndex: window.windowIndex, name });
  };

  const handleWindowTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentWindowIndex: number
  ) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = Array.from(
      tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? []
    );
    if (tabs.length === 0) return;
    const currentIndex = tabs.findIndex(
      (tab) => Number(tab.dataset.windowIndex) === currentWindowIndex
    );
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    const nextWindowIndex = Number(nextTab?.dataset.windowIndex);
    if (!nextTab || Number.isNaN(nextWindowIndex)) return;
    event.preventDefault();
    nextTab.focus();
    const nextWindow = windows.find((window) => window.windowIndex === nextWindowIndex);
    if (nextWindow) selectWindow(nextWindow);
  };

  if (!session.tmux_pane_id) return null;

  return (
    <div className={cn('shrink-0 border-b bg-muted/20', className)} data-testid="tmux-window-strip">
      <div
        ref={tablistRef}
        className="flex min-h-7 items-stretch gap-1 overflow-x-auto px-1 touch-pan-x lg:min-h-10 lg:px-2 lg:pt-1"
        role="tablist"
        aria-label={`${identity.sessionName} tmux windows`}
      >
        {windows.map((window) => {
          const editing = editingWindowIndex === window.windowIndex;
          const contextOpen = contextWindowIndex === window.windowIndex;
          return (
            <div
              key={window.windowIndex}
              className={cn(
                'group relative flex min-w-0 shrink-0 items-center rounded-t-md border border-b-0',
                window.active
                  ? 'bg-background text-foreground'
                  : 'bg-muted/40 text-muted-foreground',
                contextOpen && 'ring-2 ring-primary/50'
              )}
            >
              {editing ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onBlur={() => commitRename(window)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.currentTarget.blur();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      setEditingWindowIndex(null);
                    }
                  }}
                  className="h-7 w-28 bg-background px-2 text-xs outline-none ring-inset focus:ring-2 focus:ring-primary lg:h-8"
                  aria-label={`Rename window ${window.windowIndex}`}
                  disabled={pending}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={window.active}
                  tabIndex={window.active ? 0 : -1}
                  data-window-index={window.windowIndex}
                  disabled={pending}
                  onKeyDown={(event) => handleWindowTabKeyDown(event, window.windowIndex)}
                  onClick={(event) => {
                    if (longPressTriggeredRef.current) {
                      event.preventDefault();
                      longPressTriggeredRef.current = false;
                      return;
                    }
                    selectWindow(window);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextWindowIndex(window.windowIndex);
                  }}
                  onPointerDown={(event) => {
                    if (event.pointerType === 'mouse') return;
                    clearLongPress();
                    longPressTriggeredRef.current = false;
                    longPressTimerRef.current = globalThis.window.setTimeout(() => {
                      longPressTimerRef.current = null;
                      longPressTriggeredRef.current = true;
                      setContextWindowIndex(window.windowIndex);
                    }, 550);
                  }}
                  onPointerUp={clearLongPress}
                  onPointerCancel={clearLongPress}
                  className="flex h-7 max-w-44 min-w-16 items-center gap-1.5 px-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:h-8 lg:min-w-20 lg:text-xs"
                  aria-label={`Window ${window.windowIndex}: ${window.windowName}`}
                >
                  <span className="font-mono text-[10px] opacity-70">{window.windowIndex}</span>
                  <span className="truncate font-medium">{window.windowName}</span>
                  {window.bell && (
                    <Bell className="h-3 w-3 shrink-0 text-amber-500" aria-label="Bell" />
                  )}
                  {window.activity && (
                    <Radio className="h-3 w-3 shrink-0 text-sky-500" aria-label="Activity" />
                  )}
                </button>
              )}
              {!editing && (
                <button
                  type="button"
                  onClick={() => setContextWindowIndex(contextOpen ? null : window.windowIndex)}
                  className="flex h-7 w-7 items-center justify-center rounded-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring lg:h-8"
                  aria-label={`Window ${window.windowIndex} actions`}
                  aria-expanded={contextOpen}
                  disabled={pending}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-8 shrink-0 rounded-t-md rounded-b-none border border-b-0 px-0 lg:h-8 lg:w-9"
          onClick={() => void dispatchAction({ type: 'new', cwd: session.cwd || undefined })}
          disabled={pending}
          aria-label="New tmux window"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {contextWindowIndex !== null &&
        (() => {
          const window = windows.find((candidate) => candidate.windowIndex === contextWindowIndex);
          if (!window) return null;
          return (
            <div
              className="flex min-h-10 items-center gap-2 border-t bg-background px-2 py-1"
              role="toolbar"
              aria-label={`Window ${window.windowIndex} actions`}
            >
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {window.windowIndex} · {window.windowName}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={() => beginRename(window)}
              >
                Rename
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 text-destructive hover:text-destructive"
                onClick={() => {
                  setContextWindowIndex(null);
                  void dispatchAction({ type: 'close', windowIndex: window.windowIndex });
                }}
              >
                Close
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={() => setContextWindowIndex(null)}
                aria-label="Close window actions"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          );
        })()}
    </div>
  );
}
