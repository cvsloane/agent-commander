import { beforeEach, describe, expect, it, vi } from 'vitest';

const runId = '11111111-1111-4111-8111-111111111111';
const wakeupId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const agentId = '44444444-4444-4444-8444-444444444444';
const workItemId = '77777777-7777-4777-8777-777777777777';

describe('structured automation completion', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('atomically stores the agent summary/report and closes the wakeup', async () => {
    const baseRun = {
      id: runId,
      automation_agent_id: agentId,
      wakeup_id: wakeupId,
      repo_id: null,
      session_id: sessionId,
      status: 'running',
      objective: 'Implement the endpoint',
      memory_snapshot_json: {},
      pending_followups_json: [],
      result_summary: null,
      usage_json: {},
      worker_report_json: {},
      log_ref_json: {},
    };
    let storedRun: Record<string, unknown> = { ...baseRun };
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (
        sql === 'BEGIN'
        || sql === 'COMMIT'
        || sql === 'ROLLBACK'
        || sql.includes('pg_advisory_lock')
        || sql.includes('pg_advisory_unlock')
      ) {
        return { rows: [] };
      }
      if (sql.includes('UPDATE automation_runs') && sql.includes("status IN ('starting', 'running')")) {
        if (storedRun.status !== 'running' && storedRun.status !== 'starting') {
          return { rows: [] };
        }
        storedRun = {
          ...storedRun,
          status: values?.[1],
          result_summary: values?.[2],
          ...(sql.includes('worker_report_json')
            ? { worker_report_json: JSON.parse(String(values?.[3])) }
            : {}),
        };
        return {
          rows: [storedRun],
        };
      }
      if (sql.includes('SELECT * FROM automation_runs WHERE id = $1')) {
        return { rows: [storedRun] };
      }
      if (sql.includes('SELECT id FROM memory_trajectories')) {
        return { rows: [{ id: 'existing-trajectory' }] };
      }
      if (sql.includes('SELECT * FROM memory_trajectories')) {
        return { rows: [{ id: 'existing-trajectory', session_id: sessionId }] };
      }
      if (sql.includes('SELECT * FROM memory_entries')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT context_json') && sql.includes('FROM automation_wakeups')) {
        return { rows: [{ context_json: {} }] };
      }
      if (sql.includes('SELECT id') && sql.includes('FROM work_items')) {
        return { rows: [{ id: workItemId }] };
      }
      if (sql.includes('UPDATE work_items')) {
        return { rows: [{ id: workItemId, status: values?.[2], checkout_run_id: null }] };
      }
      if (sql.includes('UPDATE automation_runs')) {
        storedRun = {
          ...storedRun,
          worker_report_json: JSON.parse(String(values?.[0])),
        };
        return {
          rows: [storedRun],
        };
      }
      if (sql.includes('UPDATE automation_wakeups')) {
        return { rows: [{ id: wakeupId, source: 'manual', status: 'completed' }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = { query, release: vi.fn() };
    vi.doMock('../src/db/index.js', () => ({
      pool: { query, connect: vi.fn(async () => client) },
      getEvents: vi.fn(async () => []),
      getLatestSnapshot: vi.fn(async () => null),
      getRepoById: vi.fn(),
      getSessionById: vi.fn(async () => ({
        id: sessionId,
        user_id: '55555555-5555-4555-8555-555555555555',
        host_id: '66666666-6666-4666-8666-666666666666',
        provider: 'codex',
        status: 'IDLE',
        title: 'Worker',
      })),
      getSessionUsageLatest: vi.fn(async () => []),
      getToolStats: vi.fn(async () => []),
    }));
    vi.doMock('../src/config.js', () => ({ config: {} }));
    const {
      finalizeAutomationRunFromReport,
      finalizeAutomationRunFromSession,
    } = await import('../src/db/automationMemory.js');

    const report = {
      outcome: 'succeeded' as const,
      summary: 'Focused tests pass',
      detail: 'Control-plane and schema gates are green',
      evidence_refs: [{ type: 'test_gate' }],
      suggested_followups: [],
      candidate_memory_promotions: [],
    };
    const result = await finalizeAutomationRunFromReport(baseRun as never, report);

    expect(result.run).toMatchObject({
      status: 'succeeded',
      result_summary: 'Focused tests pass',
    });
    const completionUpdate = query.mock.calls.find(([sql]) => (
      String(sql).includes("status IN ('starting', 'running')")
    ));
    expect(completionUpdate?.[1]?.[1]).toBe('succeeded');
    expect(completionUpdate?.[1]?.[2]).toBe('Focused tests pass');
    expect(JSON.parse(String(completionUpdate?.[1]?.[3]))).toMatchObject({
      outcome: 'succeeded',
      summary: 'Focused tests pass',
      detail: 'Control-plane and schema gates are green',
      completion_source: 'structured_report',
    });
    const wakeupUpdate = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE automation_wakeups'));
    expect(wakeupUpdate?.[1]?.[1]).toBe('completed');
    expect(result.work_item).toMatchObject({ id: workItemId, status: 'done' });
    const beginIndex = query.mock.calls.findIndex(([sql]) => sql === 'BEGIN');
    const runIndex = query.mock.calls.findIndex(([sql]) => (
      String(sql).includes("status IN ('starting', 'running')")
    ));
    const workItemIndex = query.mock.calls.findIndex(([sql]) => String(sql).includes('UPDATE work_items'));
    const wakeupIndex = query.mock.calls.findIndex(([sql]) => String(sql).includes('UPDATE automation_wakeups'));
    const commitIndex = query.mock.calls.findIndex(([sql]) => sql === 'COMMIT');
    expect(beginIndex).toBeLessThan(runIndex);
    expect(runIndex).toBeLessThan(workItemIndex);
    expect(workItemIndex).toBeLessThan(wakeupIndex);
    expect(wakeupIndex).toBeLessThan(commitIndex);

    const replay = await finalizeAutomationRunFromReport(baseRun as never, report);
    expect(replay.replayed).toBe(true);
    expect(replay.run).toMatchObject({ status: 'succeeded' });

    const fallback = await finalizeAutomationRunFromSession(baseRun as never);
    expect(fallback.run).toMatchObject({
      status: 'succeeded',
      result_summary: 'Focused tests pass',
      worker_report_json: { completion_source: 'structured_report' },
    });
    expect(client.release).toHaveBeenCalled();
  });
});
