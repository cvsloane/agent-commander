import { describe, expect, it } from 'vitest';
import {
  buildAttachedTmuxHref,
  getAttachedTmuxSelectionUpdates,
  getTmuxViewerNavigation,
  getTmuxViewerSessionKey,
  shouldRestoreLastTmuxAttachment,
} from './tmuxNavigation';

describe('attached tmux navigation', () => {
  it('derives a stable viewer key and exact window/pane operations from session state', () => {
    const session = {
      id: 'session-2',
      host_id: 'host-1',
      tmux_pane_id: '%7',
      tmux_target: 'agents:2.1',
      metadata: null,
    } as never;
    expect(getTmuxViewerSessionKey(session)).toBe('host-1\u0000agents');
    expect(getTmuxViewerNavigation(session)).toEqual([
      { type: 'navigate', op: 'select_window', window_index: 2 },
      { type: 'navigate', op: 'select_pane', pane_id: '%7' },
    ]);
  });

  it('makes roster and quick-switch selections atomic live terminal attaches', () => {
    expect(getAttachedTmuxSelectionUpdates({ sessionId: 'session-1', hostId: 'host-1' })).toEqual({
      host_id: 'host-1',
      session_id: 'session-1',
      mode: 'terminal',
      attach: '1',
    });
  });

  it('builds the same live attach contract for recent-session links', () => {
    expect(buildAttachedTmuxHref({ sessionId: 'session-1', hostId: 'host-1' })).toBe(
      '/?host_id=host-1&session_id=session-1&mode=terminal&attach=1'
    );
  });

  it('restores only a true cold open without URL state', () => {
    expect(shouldRestoreLastTmuxAttachment('')).toBe(true);
    expect(shouldRestoreLastTmuxAttachment('filter=waiting')).toBe(false);
    expect(shouldRestoreLastTmuxAttachment('session_id=explicit')).toBe(false);
  });
});
