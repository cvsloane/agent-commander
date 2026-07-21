import type { Session } from '@agent-command/schema';
import type { TmuxHostTopologyView } from '@/stores/tmuxTopology';

export const TERMINAL_RESIZE_SETTLE_MS = 250;
export const TERMINAL_RESIZE_MIN_CELL_DELTA = 2;

export interface TerminalGridDimensions {
  cols: number;
  rows: number;
}

function sessionTmuxIdentity(session: Session) {
  const tmux = session.metadata?.tmux;
  const indexes = session.tmux_target?.match(/:(\d+)(?:\.(\d+))?$/);
  return {
    sessionName:
      session.tmux_session_name
      || tmux?.session_name
      || session.tmux_target?.split(':')[0]
      || '',
    windowIndex: session.tmux_window_index ?? tmux?.window_index ?? Number(indexes?.[1] ?? 0),
  };
}

export function parseTmuxWindowDimensions(layout: string): TerminalGridDimensions | undefined {
  const match = layout.match(/^[^,]+,(\d+)x(\d+),/);
  if (!match) return undefined;
  const cols = Number(match[1]);
  const rows = Number(match[2]);
  return cols > 0 && rows > 0 ? { cols, rows } : undefined;
}

export function getLetterboxDimensions(
  host: TmuxHostTopologyView | undefined,
  session: Session
): TerminalGridDimensions | undefined {
  if (!host || host.source !== 'topology') return undefined;
  const identity = sessionTmuxIdentity(session);
  const tmuxSession = host.sessions.find((candidate) => candidate.sessionName === identity.sessionName);
  if (!tmuxSession || tmuxSession.attachedClients < 1) return undefined;
  const window = tmuxSession.windows.find((candidate) => candidate.windowIndex === identity.windowIndex);
  if (!window) return undefined;

  const layoutDimensions = parseTmuxWindowDimensions(window.layout);
  if (layoutDimensions) return layoutDimensions;
  if (window.panes.length === 1) {
    const pane = window.panes[0];
    if (pane?.width && pane.height) return { cols: pane.width, rows: pane.height };
  }
  return undefined;
}

export function shouldDispatchTerminalResize(
  previous: TerminalGridDimensions | undefined,
  next: TerminalGridDimensions,
  minCellDelta = TERMINAL_RESIZE_MIN_CELL_DELTA
): boolean {
  if (!previous) return true;
  return Math.abs(next.cols - previous.cols) >= minCellDelta
    || Math.abs(next.rows - previous.rows) >= minCellDelta;
}

export function createSettledTerminalResize(
  dispatch: () => void,
  delayMs = TERMINAL_RESIZE_SETTLE_MS
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        dispatch();
      }, delayMs);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
