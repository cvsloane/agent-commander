import { describe, expect, it } from 'vitest';
import type { SessionWithSnapshot } from '@agent-command/schema';
import type { RecentSession } from '@/stores/ui';
import { getRecentTmuxPanes } from './quickSwitch';

describe('mobile tmux quick switch', () => {
  it('keeps the selected pane first and follows shared recent-session order', () => {
    const live = [
      { id: 'current', tmux_pane_id: '%1', status: 'RUNNING' },
      { id: 'recent', tmux_pane_id: '%2', status: 'WAITING_FOR_INPUT' },
      { id: 'not-recent', tmux_pane_id: '%3', status: 'IDLE' },
    ] as SessionWithSnapshot[];
    const recent = [
      { id: 'recent', visitedAt: '2026-07-20T13:00:00.000Z' },
      { id: 'missing', visitedAt: '2026-07-20T12:00:00.000Z' },
      { id: 'current', visitedAt: '2026-07-20T11:00:00.000Z' },
    ] as RecentSession[];

    expect(getRecentTmuxPanes(recent, live, 'current').map((session) => session.id)).toEqual([
      'current',
      'recent',
    ]);
  });
});
