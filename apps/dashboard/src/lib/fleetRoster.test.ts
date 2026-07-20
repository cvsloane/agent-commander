import { describe, expect, it } from 'vitest';
import type { SessionEdge, SessionWithSnapshot } from '@agent-command/schema';
import {
  buildFleetRosterGroups,
  filterFleetRosterGroups,
  fleetGroupForSession,
  groupSessions,
} from './fleetRoster';

const hostA = '11111111-1111-4111-8111-111111111111';
const hostB = '22222222-2222-4222-8222-222222222222';

function session(id: string, overrides: Partial<SessionWithSnapshot> = {}): SessionWithSnapshot {
  return {
    id,
    host_id: hostA,
    user_id: null,
    repo_id: null,
    kind: 'tmux_pane',
    provider: 'codex',
    status: 'RUNNING',
    role: 'standalone',
    title: id,
    cwd: '/repo',
    repo_root: '/repo',
    git_remote: null,
    git_branch: 'main',
    tmux_pane_id: `%${id.slice(0, 2)}`,
    tmux_target: 'agents:0.0',
    metadata: { tmux: { session_name: 'agents', window_name: 'repo', window_index: 0, pane_index: 0 } },
    created_at: '2026-07-19T12:00:00.000Z',
    updated_at: '2026-07-19T12:00:00.000Z',
    last_activity_at: '2026-07-19T12:00:00.000Z',
    idled_at: null,
    group_id: null,
    forked_from: null,
    fork_depth: 0,
    archived_at: null,
    ...overrides,
  };
}

function edge(parent: string, child: string): SessionEdge {
  return {
    parent_session_id: parent,
    child_session_id: child,
    edge_type: 'orchestrates',
    created_at: '2026-07-19T12:00:00.000Z',
  };
}

describe('fleet roster grouping', () => {
  it('groups workers under their orchestrator regardless of tmux window layout', () => {
    const orchestrator = session('00000000-0000-4000-8000-000000000001', {
      role: 'orchestrator',
      title: 'Fleet lead',
      tmux_target: 'agents:1.0',
    });
    const worker = session('00000000-0000-4000-8000-000000000002', {
      role: 'worker',
      title: 'Worker',
      tmux_target: 'other:9.3',
      metadata: { tmux: { session_name: 'other', window_name: 'far-away', window_index: 9, pane_index: 3 } },
    });
    const standalone = session('00000000-0000-4000-8000-000000000003', {
      title: 'Standalone',
      tmux_target: 'ops:0.0',
      metadata: { tmux: { session_name: 'ops', window_name: 'logs', window_index: 0, pane_index: 0 } },
    });

    const groups = buildFleetRosterGroups(
      [orchestrator, worker, standalone],
      [edge(orchestrator.id, worker.id)]
    );

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      kind: 'orchestrator',
      title: 'Fleet lead',
      paneCount: 2,
    });
    expect(groups[0]?.kind === 'orchestrator' ? groups[0].workers[0]?.session.id : null).toBe(worker.id);
    expect(groups[1]).toMatchObject({ kind: 'tmux', paneCount: 1 });
    expect(fleetGroupForSession(groups, worker.id)?.key).toBe(groups[0]?.key);
  });

  it('keeps same-named tmux sessions separate by host and sorts waiting work first', () => {
    const active = session('00000000-0000-4000-8000-000000000004', { host_id: hostA });
    const waiting = session('00000000-0000-4000-8000-000000000005', {
      host_id: hostB,
      status: 'WAITING_FOR_INPUT',
    });

    const groups = buildFleetRosterGroups([active, waiting], [], {
      allHosts: true,
      waitingFirst: true,
    });

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.hostIds[0])).toEqual([hostB, hostA]);
    expect(new Set(groups.map((group) => group.key)).size).toBe(2);
  });

  it('retains the complete orchestrator family when only a worker matches a filter', () => {
    const orchestrator = session('00000000-0000-4000-8000-000000000006', {
      role: 'orchestrator',
      title: 'Fleet lead',
    });
    const waitingWorker = session('00000000-0000-4000-8000-000000000007', {
      role: 'worker',
      status: 'WAITING_FOR_APPROVAL',
    });
    const groups = buildFleetRosterGroups(
      [orchestrator, waitingWorker],
      [edge(orchestrator.id, waitingWorker.id)]
    );

    const filtered = filterFleetRosterGroups(
      groups,
      (candidate) => candidate.status === 'WAITING_FOR_APPROVAL'
    );

    expect(filtered).toHaveLength(1);
    expect(groupSessions(filtered[0]!)).toEqual([orchestrator, waitingWorker]);
  });

  it('still filters individual panes inside ordinary tmux groups', () => {
    const active = session('00000000-0000-4000-8000-000000000008');
    const waiting = session('00000000-0000-4000-8000-000000000009', {
      status: 'WAITING_FOR_INPUT',
      tmux_target: 'agents:0.1',
      metadata: { tmux: { session_name: 'agents', window_name: 'repo', window_index: 0, pane_index: 1 } },
    });
    const groups = buildFleetRosterGroups([active, waiting], []);

    const filtered = filterFleetRosterGroups(
      groups,
      (candidate) => candidate.status === 'WAITING_FOR_INPUT'
    );

    expect(filtered).toHaveLength(1);
    expect(groupSessions(filtered[0]!)).toEqual([waiting]);
  });
});
