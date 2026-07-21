import { afterEach, describe, expect, it } from 'vitest';
import { useUIStore } from './ui';

describe('UI tmux attachment state', () => {
  afterEach(() => useUIStore.setState({ lastAttachedTmux: null }));

  it('records and clears the last attached host and session together', () => {
    useUIStore.getState().setLastAttachedTmux({ hostId: 'host-1', sessionId: 'session-1' });
    expect(useUIStore.getState().lastAttachedTmux).toEqual({
      hostId: 'host-1',
      sessionId: 'session-1',
    });

    useUIStore.getState().setLastAttachedTmux(null);
    expect(useUIStore.getState().lastAttachedTmux).toBeNull();
  });
});
