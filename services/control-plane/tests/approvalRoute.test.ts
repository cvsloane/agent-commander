import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Approval, Session } from '@agent-command/schema';
import type { AuthUser } from '../src/auth/types.js';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const approvalId = '33333333-3333-4333-8333-333333333333';
const userId = '44444444-4444-4444-8444-444444444444';

function session(): Session {
  return {
    id: sessionId,
    host_id: hostId,
    user_id: userId,
    repo_id: null,
    kind: 'tmux_pane',
    provider: 'claude_code',
    status: 'WAITING_FOR_APPROVAL',
    title: 'Approval test',
    cwd: '/tmp',
    repo_root: null,
    git_remote: null,
    git_branch: null,
    tmux_pane_id: '%1',
    tmux_target: 'agents:0.0',
    metadata: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    idled_at: null,
    group_id: null,
    forked_from: null,
    fork_depth: 0,
    archived_at: null,
  };
}

async function buildServer(options: {
  failTransaction?: boolean;
  loseDecisionRace?: boolean;
} = {}): Promise<{
  app: FastifyInstance;
  enqueue: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  let currentApproval: Approval = {
    id: approvalId,
    session_id: sessionId,
    provider: 'claude_code',
    ts_requested: new Date().toISOString(),
    ts_decided: null,
    timed_out_at: null,
    decision: null,
    requested_payload: {},
    decided_payload: null,
    decided_by_user_id: null,
  };
  const idempotentRecords = new Map<string, Record<string, unknown>>();
  const enqueue = vi.fn(async (input: Record<string, unknown>) => {
    const key = typeof input.idempotency_key === 'string' ? input.idempotency_key : null;
    if (key && idempotentRecords.has(key)) {
      return { record: idempotentRecords.get(key), created: false };
    }
    const record = { ...input, status: 'queued' };
    if (key) idempotentRecords.set(key, record);
    return { record, created: true };
  });
  vi.doMock('../src/db/commandOutbox.js', () => ({
    commandOutbox: {
      enqueue,
      getByIdForHost: vi.fn(async () => null),
      getByIdempotencyKey: vi.fn(async (_hostId: string, key: string) => (
        idempotentRecords.get(key) ?? null
      )),
      markSent: vi.fn(async () => null),
      markQueued: vi.fn(async () => null),
      markCompleted: vi.fn(async () => null),
      markFailed: vi.fn(async () => null),
      listDeliverable: vi.fn(async () => []),
      expireStale: vi.fn(async () => []),
      pruneTerminal: vi.fn(async () => 0),
    },
    decideApprovalAndEnqueue: vi.fn(async (input: {
      decision: 'allow' | 'deny';
      decided_payload: Record<string, unknown>;
      decided_by_user_id: string;
      command: Record<string, unknown>;
    }) => {
      if (options.failTransaction) throw new Error('database unavailable');
      const enqueued = await enqueue(input.command);
      currentApproval = {
        ...currentApproval,
        decision: input.decision,
        decided_payload: input.decided_payload,
        decided_by_user_id: input.decided_by_user_id,
        ts_decided: new Date().toISOString(),
      };
      if (options.loseDecisionRace) return null;
      return { approval: currentApproval, command: enqueued.record };
    }),
  }));
  vi.doMock('../src/db/index.js', () => ({
    pool: { query: vi.fn(async () => ({ rows: [] })) },
    getApprovalById: vi.fn(async (id: string) => (
      id === approvalId ? currentApproval : null
    )),
    getSessionById: vi.fn(async () => session()),
    clearSessionApprovalMetadata: vi.fn(async () => session()),
    updateApprovalMetrics: vi.fn(async () => undefined),
    createAuditLog: vi.fn(async () => undefined),
  }));

  const { registerApprovalRoutes } = await import('../src/routes/approvals.js');
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => {
    request.user = {
      id: userId,
      sub: 'operator@example.test',
      role: 'operator',
      auth_type: 'jwt',
    } satisfies AuthUser;
  });
  registerApprovalRoutes(app);
  return { app, enqueue };
}

describe('approval decision route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('queues an offline approval decision as a durable legacy wire message', async () => {
    const { app, enqueue } = await buildServer();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${approvalId}/decide`,
      payload: { decision: 'allow' },
    });

    expect(response.statusCode).toBe(200);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      host_id: hostId,
      session_id: sessionId,
      type: 'approvals.decision',
      class: 'durable',
      payload: expect.objectContaining({
        type: 'approvals.decision',
        payload: expect.objectContaining({ approval_id: approvalId }),
      }),
    }));
    await app.close();
  });

  it('returns the original decision for the same Idempotency-Key without redispatching', async () => {
    const { app, enqueue } = await buildServer();
    const request = {
      method: 'POST' as const,
      url: `/v1/approvals/${approvalId}/decide`,
      headers: { 'idempotency-key': 'approve-once' },
      payload: { decision: 'allow' },
    };

    const first = await app.inject(request);
    const second = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().approval).toMatchObject({
      id: approvalId,
      decision: 'allow',
    });
    expect(enqueue).toHaveBeenCalledOnce();
    await app.close();
  });

  it('leaves the approval undecided when the transactional enqueue fails', async () => {
    const { app } = await buildServer({ failTransaction: true });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${approvalId}/decide`,
      payload: { decision: 'allow' },
    });
    const approvalResponse = await app.inject({
      method: 'GET',
      url: `/v1/approvals/${approvalId}`,
    });

    expect(response.statusCode).toBe(500);
    expect(approvalResponse.json().approval.decision).toBeNull();
    await app.close();
  });

  it('rejects reuse of an Idempotency-Key for a different decision', async () => {
    const { app, enqueue } = await buildServer();
    const request = {
      method: 'POST' as const,
      url: `/v1/approvals/${approvalId}/decide`,
      headers: { 'idempotency-key': 'approval-decision' },
    };

    const first = await app.inject({ ...request, payload: { decision: 'allow' } });
    const conflict = await app.inject({ ...request, payload: { decision: 'deny' } });

    expect(first.statusCode).toBe(200);
    expect(conflict.statusCode).toBe(409);
    expect(enqueue).toHaveBeenCalledOnce();
    await app.close();
  });

  it('replays the winning approval decision after losing a concurrent race', async () => {
    const { app, enqueue } = await buildServer({ loseDecisionRace: true });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${approvalId}/decide`,
      headers: { 'idempotency-key': 'concurrent-approval' },
      payload: { decision: 'allow' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().approval).toMatchObject({ id: approvalId, decision: 'allow' });
    expect(enqueue).toHaveBeenCalledOnce();
    await app.close();
  });
});
