import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OrchestratorFleetResponse,
  SessionWithSnapshot,
  TmuxTopologyPayload,
} from '@agent-command/schema';
import {
  selectFleetCards,
  selectFleetRosterGroups,
  TMUX_TOPOLOGY_STALE_AFTER_MS,
  useFleetStore,
} from './fleet';

const hostId = '11111111-1111-4111-8111-111111111111';

function session(
  id: string,
  overrides: Partial<SessionWithSnapshot> = {}
): SessionWithSnapshot {
  return {
    id,
    host_id: hostId,
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
    tmux_pane_id: `%${id.slice(-2)}`,
    tmux_target: 'agents:0.0',
    metadata: {
      tmux: {
        session_name: 'agents',
        window_name: 'repo',
        window_index: 0,
        pane_index: 0,
      },
    },
    created_at: '2026-07-20T12:00:00.000Z',
    updated_at: '2026-07-20T12:00:00.000Z',
    last_activity_at: '2026-07-20T12:00:00.000Z',
    idled_at: null,
    group_id: null,
    forked_from: null,
    fork_depth: 0,
    archived_at: null,
    latest_snapshot: null,
    ...overrides,
  };
}

function aggregate(): OrchestratorFleetResponse {
  const orchestrator = session('00000000-0000-4000-8000-000000000001', {
    role: 'orchestrator',
    title: 'Fleet lead',
  });
  const worker = session('00000000-0000-4000-8000-000000000002', {
    role: 'worker',
    title: 'Builder',
    tmux_target: 'agents:0.1',
  });
  return {
    orchestrators: [{
      session: orchestrator,
      children: [worker],
      edges: [{
        parent_session_id: orchestrator.id,
        child_session_id: worker.id,
        edge_type: 'orchestrates',
        created_at: '2026-07-20T12:00:00.000Z',
      }],
      agent_tasks: [],
      rollup: {
        session_id: orchestrator.id,
        child_sessions: { total: 1, by_status: { RUNNING: 1 } },
        agent_tasks: { total: 0, running: 0, completed: 0, failed: 0 },
      },
      work_item_counts: {
        total: 1,
        by_status: { queued: 0, in_progress: 1, blocked: 0, done: 0, cancelled: 0 },
      },
      automation_agent: null,
      latest_run: null,
      latest_report: null,
      budget_policy: {},
      budget_usage: null,
      usage_rollup: {},
    }],
  };
}

describe('fleet store', () => {
  beforeEach(() => useFleetStore.getState().reset());
  afterEach(() => vi.useRealTimers());

  it('ingests the aggregate once and exposes the same family to fleet cards', () => {
    useFleetStore.getState().ingestAggregate(aggregate());

    const cards = selectFleetCards(useFleetStore.getState());
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      session: { title: 'Fleet lead' },
      children: [{ title: 'Builder' }],
      work_item_counts: { total: 1 },
    });
    expect(useFleetStore.getState().sessionsById[cards[0]!.session.id]).toEqual(cards[0]!.session);
    expect(useFleetStore.getState().sessionsById[cards[0]!.children[0]!.id]).toEqual(cards[0]!.children[0]);
  });

  it('uses the aggregate family edges for the roster-tree presentation', () => {
    const response = aggregate();
    const family = response.orchestrators[0]!;
    useFleetStore.getState().ingestAggregate(response);
    useFleetStore.getState().setRoster(hostId, [family.session, ...family.children]);

    const groups = selectFleetRosterGroups(useFleetStore.getState(), [hostId]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: 'orchestrator',
      title: 'Fleet lead',
      workers: [{ session: { title: 'Builder' } }],
    });
  });

  it('reconciles aggregate session fields into an already tracked roster', () => {
    const response = aggregate();
    const family = response.orchestrators[0]!;
    useFleetStore.getState().setRoster(hostId, [family.session, ...family.children]);
    response.orchestrators[0] = {
      ...family,
      session: { ...family.session, status: 'WAITING_FOR_APPROVAL' },
    };

    useFleetStore.getState().ingestAggregate(response);

    expect(selectFleetRosterGroups(useFleetStore.getState(), [hostId])[0]).toMatchObject({
      kind: 'orchestrator',
      orchestrator: { session: { status: 'WAITING_FOR_APPROVAL' } },
    });
  });

  it('applies session event deltas to both presentations without losing snapshot context', () => {
    const response = aggregate();
    const family = response.orchestrators[0]!;
    const worker = {
      ...family.children[0]!,
      latest_snapshot: {
        created_at: '2026-07-20T12:01:00.000Z',
        capture_text: 'Working',
        capture_hash: 'snapshot-1',
      },
    };
    response.orchestrators[0] = { ...family, children: [worker] };
    useFleetStore.getState().ingestAggregate(response);
    useFleetStore.getState().setRoster(hostId, [family.session, worker]);

    const { latest_snapshot: _snapshot, ...changedWorker } = worker;
    useFleetStore.getState().applySessionsChanged([
      { ...changedWorker, status: 'WAITING_FOR_INPUT', title: 'Builder needs input' },
    ]);

    expect(selectFleetCards(useFleetStore.getState())[0]?.children[0]).toMatchObject({
      status: 'WAITING_FOR_INPUT',
      title: 'Builder needs input',
      latest_snapshot: { capture_hash: 'snapshot-1' },
    });
    expect(selectFleetRosterGroups(useFleetStore.getState(), [hostId])[0]).toMatchObject({
      kind: 'orchestrator',
      workers: [{ session: { status: 'WAITING_FOR_INPUT', title: 'Builder needs input' } }],
    });
    expect(useFleetStore.getState().hosts[hostId]).toMatchObject({
      sessions: [{ windows: [{ panes: expect.arrayContaining([
        expect.objectContaining({
          sessionId: worker.id,
          sessionStatus: 'WAITING_FOR_INPUT',
        }),
      ]) }] }],
    });
  });

  it('removes deleted sessions from cards and tracked host rosters', () => {
    const response = aggregate();
    const family = response.orchestrators[0]!;
    useFleetStore.getState().ingestAggregate(response);
    useFleetStore.getState().setRoster(hostId, [family.session, ...family.children]);

    useFleetStore.getState().applySessionsChanged([], [family.children[0]!.id]);

    expect(selectFleetCards(useFleetStore.getState())[0]?.children).toEqual([]);
    expect(useFleetStore.getState().rosterByHost[hostId]).toEqual([family.session]);
    expect(useFleetStore.getState().sessionsById[family.children[0]!.id]).toBeUndefined();
  });

  it('expires a silent live-topology feed back to its roster snapshot on a timer tick', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-07-20T14:00:00.000Z');
    const roster = session('00000000-0000-4000-8000-000000000003');
    const topology: TmuxTopologyPayload = {
      reason: 'poll',
      tmux_sessions: [{
        session_name: 'agents',
        attached: true,
        windows: [{
          window_index: 0,
          window_name: 'live-name',
          active: true,
          zoomed: false,
          layout: 'tiled',
          bell: false,
          activity: false,
          panes: [],
        }],
      }],
    };
    useFleetStore.getState().setRoster(hostId, [roster]);
    useFleetStore.getState().receiveTopology(hostId, topology);
    expect(useFleetStore.getState().hosts[hostId]?.source).toBe('topology');

    vi.advanceTimersByTime(TMUX_TOPOLOGY_STALE_AFTER_MS + 1);
    useFleetStore.getState().expireStaleTopologies();

    expect(useFleetStore.getState().hosts[hostId]).toMatchObject({
      source: 'roster',
      sessions: [{ windows: [{ windowName: 'repo' }] }],
    });
  });

  it('applies graph and task event payloads to the canonical family', () => {
    const response = aggregate();
    const family = response.orchestrators[0]!;
    const replacementWorker = session('00000000-0000-4000-8000-000000000004', {
      role: 'worker',
      title: 'Reviewer',
      tmux_target: 'agents:0.2',
    });
    useFleetStore.getState().ingestAggregate(response);
    useFleetStore.getState().setRoster(hostId, [family.session, replacementWorker]);

    useFleetStore.getState().applySessionEdges(family.session.id, [{
      parent_session_id: family.session.id,
      child_session_id: replacementWorker.id,
      edge_type: 'orchestrates',
      created_at: '2026-07-20T12:02:00.000Z',
    }]);
    useFleetStore.getState().applyAgentTasks(family.session.id, [{
      id: '00000000-0000-4000-8000-000000000005',
      session_id: family.session.id,
      tool_use_id: 'task-1',
      description: 'Review fleet changes',
      status: 'running',
      started_at: '2026-07-20T12:02:00.000Z',
      ended_at: null,
      metadata: {},
    }]);

    expect(selectFleetCards(useFleetStore.getState())[0]).toMatchObject({
      children: [{ title: 'Reviewer' }],
      agent_tasks: [{ description: 'Review fleet changes' }],
    });
    expect(selectFleetRosterGroups(useFleetStore.getState(), [hostId])[0]).toMatchObject({
      kind: 'orchestrator',
      workers: [{ session: { title: 'Reviewer' } }],
    });
  });
});
