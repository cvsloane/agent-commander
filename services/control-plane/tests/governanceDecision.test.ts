import { beforeEach, describe, expect, it, vi } from 'vitest';

const userId = '11111111-1111-4111-8111-111111111111';
const approvalId = '22222222-2222-4222-8222-222222222222';
const agentId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';
const wakeupId = '55555555-5555-4555-8555-555555555555';
const repoId = '66666666-6666-4666-8666-666666666666';
const workItemId = '77777777-7777-4777-8777-777777777777';

describe('transactional governance decisions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function load(decision: 'approved' | 'denied') {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM governance_approvals AS approval')) {
        return {
          rows: [{
            id: approvalId,
            user_id: userId,
            automation_agent_id: agentId,
            automation_run_id: runId,
            type: decision === 'approved' ? 'host_selection' : 'budget_override',
            status: 'pending',
            request_payload: {},
            wakeup_id: wakeupId,
            run_repo_id: repoId,
            wakeup_repo_id: repoId,
            wakeup_context_json: {
              objective: 'Resume original work',
            },
            claimed_work_item_id: workItemId,
          }],
        };
      }
      if (sql.includes('UPDATE governance_approvals')) {
        return {
          rows: [{
            id: approvalId,
            user_id: userId,
            automation_agent_id: agentId,
            automation_run_id: runId,
            type: decision === 'approved' ? 'host_selection' : 'budget_override',
            status: decision,
            request_payload: {},
            decision_payload: values?.[3],
          }],
        };
      }
      if (sql.includes('INSERT INTO automation_wakeups')) {
        return {
          rows: [{
            id: '88888888-8888-4888-8888-888888888888',
            automation_agent_id: agentId,
            repo_id: repoId,
            source: 'approval_resume',
            status: 'queued',
            context_json: JSON.parse(String(values?.[3])),
          }],
        };
      }
      if (sql.includes('UPDATE automation_runs')) {
        return { rows: [{ id: runId, status: 'cancelled' }] };
      }
      if (sql.includes('UPDATE automation_wakeups')) {
        return { rows: [{ id: wakeupId, source: 'manual', status: 'failed' }] };
      }
      if (sql.includes('UPDATE work_items')) {
        return { rows: [{ id: workItemId, status: 'blocked' }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = { query, release: vi.fn() };
    vi.doMock('../src/db/index.js', () => ({
      pool: { connect: vi.fn(async () => client), query: vi.fn() },
      getEvents: vi.fn(),
      getLatestSnapshot: vi.fn(),
      getRepoById: vi.fn(),
      getSessionById: vi.fn(),
      getSessionUsageLatest: vi.fn(),
      getToolStats: vi.fn(),
    }));
    vi.doMock('../src/config.js', () => ({ config: {} }));
    const module = await import('../src/db/automationMemory.js');
    return { decide: module.decideGovernanceApprovalWithOutcome, query, client };
  }

  it('copies the original wake context and host pin into approval_resume', async () => {
    const { decide, query, client } = await load('approved');
    const outcome = await decide(userId, approvalId, userId, {
      decision: 'approved',
      decision_payload: {
        host_id: '99999999-9999-4999-8999-999999999999',
      },
    });

    expect(outcome?.wakeup).toMatchObject({ source: 'approval_resume', status: 'queued' });
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO automation_wakeups'));
    const context = JSON.parse(String(insert?.[1]?.[3]));
    expect(context).toMatchObject({
      objective: 'Resume original work',
      work_item_id: workItemId,
      preflight_override: {
        host_id: '99999999-9999-4999-8999-999999999999',
      },
      approval_resume: {
        approval_id: approvalId,
        original_run_id: runId,
        original_wakeup_id: wakeupId,
      },
    });
    expect(client.release).toHaveBeenCalled();
  });

  it('cancels the blocked run, fails its wake, and releases its work item on denial', async () => {
    const { decide, query } = await load('denied');
    const outcome = await decide(userId, approvalId, userId, {
      decision: 'denied',
      decision_payload: {},
    });

    expect(outcome).toMatchObject({
      run: { status: 'cancelled' },
      wakeup: { status: 'failed' },
      work_item: { status: 'blocked' },
    });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("status = 'cancelled'"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("status = 'failed'"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("status = 'blocked'"))).toBe(true);
  });
});
