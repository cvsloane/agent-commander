import { describe, expect, it } from 'vitest';
import type { TmuxWindowTopologyView } from '@/stores/tmuxTopology';
import { getAdjacentTmuxWindow, getWindowViewerSessionId } from './TmuxWindowStrip';

describe('tmux window viewer retargeting', () => {
  it('targets the selected window active pane, with a tracked-pane fallback', () => {
    const window = {
      panes: [
        { active: false, sessionId: 'session-1' },
        { active: true, sessionId: 'session-2' },
      ],
    } as TmuxWindowTopologyView;

    expect(getWindowViewerSessionId(window)).toBe('session-2');
    expect(getWindowViewerSessionId({
      ...window,
      panes: [{ active: true }, { active: false, sessionId: 'session-3' }],
    } as TmuxWindowTopologyView)).toBe('session-3');
  });
});

describe('terminal swipe window navigation', () => {
  const windows = [
    { windowIndex: 0, active: false },
    { windowIndex: 1, active: true },
    { windowIndex: 2, active: false },
  ] as Parameters<typeof getAdjacentTmuxWindow>[0];

  it('moves spatially through windows and wraps at the ends', () => {
    expect(getAdjacentTmuxWindow(windows, 'next')?.windowIndex).toBe(2);
    expect(getAdjacentTmuxWindow(windows, 'previous')?.windowIndex).toBe(0);
    expect(getAdjacentTmuxWindow(
      windows.map((window) => ({ ...window, active: window.windowIndex === 2 })),
      'next'
    )?.windowIndex).toBe(0);
  });
});
