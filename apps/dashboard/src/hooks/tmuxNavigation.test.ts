import { describe, expect, it } from 'vitest';
import {
  buildAttachedTmuxHref,
  getAttachedTmuxSelectionUpdates,
  shouldRestoreLastTmuxAttachment,
} from './tmuxNavigation';

describe('attached tmux navigation', () => {
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
