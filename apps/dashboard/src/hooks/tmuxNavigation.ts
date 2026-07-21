import type { BrowserTerminalNavigateMessage, Session } from '@agent-command/schema';

export interface AttachedTmuxSelection {
  sessionId: string;
  hostId?: string | null;
}

function getTmuxSessionName(session: Session): string | undefined {
  return session.tmux_session_name
    || session.metadata?.tmux?.session_name
    || session.tmux_target?.split(':')[0]
    || undefined;
}

export function getTmuxViewerSessionKey(session: Session): string | undefined {
  const sessionName = getTmuxSessionName(session);
  if (!session.host_id || !sessionName || !session.tmux_pane_id) return undefined;
  return `${session.host_id}\u0000${sessionName}`;
}

export function getTmuxViewerNavigation(session: Session): BrowserTerminalNavigateMessage[] {
  const targetIndexes = session.tmux_target?.match(/:(\d+)(?:\.(\d+))?$/);
  const windowIndex = session.tmux_window_index
    ?? session.metadata?.tmux?.window_index
    ?? (targetIndexes?.[1] === undefined ? undefined : Number(targetIndexes[1]));
  const messages: BrowserTerminalNavigateMessage[] = [];
  if (windowIndex !== undefined && Number.isInteger(windowIndex) && windowIndex >= 0) {
    messages.push({ type: 'navigate', op: 'select_window', window_index: windowIndex });
  }
  if (session.tmux_pane_id) {
    messages.push({ type: 'navigate', op: 'select_pane', pane_id: session.tmux_pane_id });
  }
  return messages;
}

export function getAttachedTmuxSelectionUpdates({
  sessionId,
  hostId,
}: AttachedTmuxSelection): Record<string, string> {
  return {
    ...(hostId ? { host_id: hostId } : {}),
    session_id: sessionId,
    mode: 'terminal',
    attach: '1',
  };
}

export function buildAttachedTmuxHref(selection: AttachedTmuxSelection): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(getAttachedTmuxSelectionUpdates(selection))) {
    params.set(key, value);
  }
  return `/?${params.toString()}`;
}

export function shouldRestoreLastTmuxAttachment(search: string): boolean {
  return new URLSearchParams(search).size === 0;
}
