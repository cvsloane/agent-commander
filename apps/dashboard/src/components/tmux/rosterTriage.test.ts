import { describe, expect, it } from 'vitest';
import type { SessionWithSnapshot } from '@agent-command/schema';
import type { FleetRosterGroup } from '@/lib/fleetRoster';
import { firstRosterTriageTarget, summarizeRosterTriage } from './rosterTriage';

function session(id: string, status: string): SessionWithSnapshot {
  return { id, status } as SessionWithSnapshot;
}

describe('roster triage chain', () => {
  it('counts approval and waiting panes separately and prioritizes approval', () => {
    expect(summarizeRosterTriage([
      session('input', 'WAITING_FOR_INPUT'),
      session('approval', 'WAITING_FOR_APPROVAL'),
      session('running', 'RUNNING'),
    ])).toEqual({ approvalCount: 1, waitingCount: 1, firstSessionId: 'approval' });
  });

  it('finds the first matching pane with its collapsed group key', () => {
    const groups = [
      {
        kind: 'tmux',
        key: 'tmux:quiet',
        cluster: { windows: [{ panes: [{ session: session('quiet', 'IDLE') }] }] },
      },
      {
        kind: 'tmux',
        key: 'tmux:waiting',
        cluster: { windows: [{ panes: [{ session: session('target', 'WAITING_FOR_INPUT') }] }] },
      },
    ] as FleetRosterGroup[];
    expect(firstRosterTriageTarget(groups)).toEqual({
      groupKey: 'tmux:waiting',
      sessionId: 'target',
    });
  });
});
