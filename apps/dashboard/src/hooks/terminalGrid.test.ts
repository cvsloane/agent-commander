import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@agent-command/schema';
import type { TmuxHostTopologyView } from '@/stores/tmuxTopology';
import {
  createSettledTerminalResize,
  getLetterboxDimensions,
  shouldDispatchTerminalResize,
} from './terminalGrid';

const session = {
  id: '22222222-2222-4222-8222-222222222222',
  host_id: '11111111-1111-4111-8111-111111111111',
  tmux_session_name: 'agents',
  tmux_window_index: 2,
} as Session;

function topology(attachedClients: number): TmuxHostTopologyView {
  return {
    hostId: session.host_id,
    source: 'topology',
    receivedAt: '2026-07-20T20:00:00.000Z',
    sessions: [{
      sessionName: 'agents',
      attached: attachedClients > 0,
      attachedClients,
      windows: [{
        windowIndex: 2,
        windowName: 'builder',
        active: true,
        zoomed: false,
        layout: '8f5a,160x50,0,0,1',
        bell: false,
        activity: false,
        panes: [],
      }],
    }],
  };
}

describe('terminal grid policy', () => {
  afterEach(() => vi.useRealTimers());

  it('letterboxes to the shared desktop grid and stays viewport-fitted when solo', () => {
    expect(getLetterboxDimensions(topology(1), session)).toEqual({ cols: 160, rows: 50 });
    expect(getLetterboxDimensions(topology(0), session)).toBeUndefined();
  });

  it('does not dispatch while simulated keyboard geometry is still animating', () => {
    vi.useFakeTimers();
    const dispatch = vi.fn();
    const settled = createSettledTerminalResize(dispatch);

    settled.schedule();
    vi.advanceTimersByTime(100);
    settled.schedule();
    vi.advanceTimersByTime(100);
    settled.schedule();
    vi.advanceTimersByTime(249);
    expect(dispatch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('gates resize dispatches below the minimum cell delta', () => {
    expect(shouldDispatchTerminalResize({ cols: 100, rows: 30 }, { cols: 101, rows: 29 })).toBe(false);
    expect(shouldDispatchTerminalResize({ cols: 100, rows: 30 }, { cols: 102, rows: 30 })).toBe(true);
  });
});
