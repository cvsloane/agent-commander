import type { BrowserTerminalNavigateMessage } from '@agent-command/schema';

interface MobileFocusNavigationState {
  autoFocusPane: boolean;
  connected: boolean;
  focusRequested?: boolean;
  paneCount: number;
  previousTargetKey: string | null;
  targetKey: string | null;
  terminalVisible: boolean;
  zoomed: boolean;
}

export function getMobileFocusNavigation({
  autoFocusPane,
  connected,
  focusRequested = false,
  paneCount,
  previousTargetKey,
  targetKey,
  terminalVisible,
  zoomed,
}: MobileFocusNavigationState): BrowserTerminalNavigateMessage | null {
  if (!connected) return null;
  if (!terminalVisible || !autoFocusPane || paneCount <= 1) {
    return zoomed || focusRequested
      ? { type: 'navigate', op: 'zoom', on: false }
      : null;
  }
  if (!targetKey) return null;
  if (!zoomed || targetKey !== previousTargetKey) {
    return { type: 'navigate', op: 'zoom', on: true };
  }
  return null;
}
