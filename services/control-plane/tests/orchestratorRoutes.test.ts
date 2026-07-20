import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/auth/types.js';

const parentId = '11111111-1111-4111-8111-111111111111';
const childId = '22222222-2222-4222-8222-222222222222';
const hostId = '33333333-3333-4333-8333-333333333333';
const userId = '44444444-4444-4444-8444-444444444444';
const repoId = '55555555-5555-4555-8555-555555555555';
const workItemId = '66666666-6666-4666-8666-666666666666';
const now = '2026-07-19T18:00:00.000Z';

const parent = {
  id: parentId,
  host_id: hostId,
  user_id: userId,
  repo_id: repoId,
  kind: 'tmux_pane',
  provider: 'codex',
  status: 'RUNNING',
  role: 'standalone',
  title: 'Lead',
  metadata: {},
  fork_depth: 0,
  created_at: now,
  updated_at: now,
};
const child = {
  ...parent,
  id: childId,
  role: 'worker',
  title: 'Worker',
};
const edge = {
  parent_session_id: parentId,
  child_session_id: childId,
  edge_type: 'spawned',
  created_at: now,
};
const rollup = {
  session_id: parentId,
  child_sessions: { total: 1, by_status: { RUNNING: 1 } },
  agent_tasks: { total: 0, running: 0, completed: 0, failed: 0 },
};
const workItem = {
  id: workItemId,
  user_id: userId,
  repo_id: repoId,
  session_id: parentId,
  title: 'Implement API',
  objective: 'Ship it',
  status: 'in_progress',
  priority: 1,
  payload_json: {},
};

async function buildServer(): Promise<{
  app: FastifyInstance;
  spawnSessionOnHost: ReturnType<typeof vi.fn>;
  queueInputToSession: ReturnType<typeof vi.fn>;
  claimWorkItemForSession: ReturnType<typeof vi.fn>;
  completeWorkItemForSession: ReturnType<typeof vi.fn>;
  createMemoryEntry: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  vi.doMock('../src/db/index.js', () => ({
    getSessionById: vi.fn(async (id: string) => id === parentId ? parent : id === childId ? child : null),
    getSessionsByIds: vi.fn(async () => [child]),
    getSessionWithSnapshot: vi.fn(async () => ({
      session: child,
      snapshot: { id: 1, session_id: childId, capture_text: 'working', capture_hash: 'hash', created_at: now },
      events: [],
      approvals: [],
    })),
    createAuditLog: vi.fn(async () => undefined),
  }));
  vi.doMock('../src/db/sessionGraph.js', () => ({
    sessionGraph: {
      list: vi.fn(async () => [edge]),
      rollup: vi.fn(async (id: string) => ({ ...rollup, session_id: id })),
      setRole: vi.fn(async () => ({ ...parent, role: 'orchestrator' })),
    },
  }));
  vi.doMock('../src/db/agentTasks.js', () => ({
    agentTasks: { list: vi.fn(async () => []) },
  }));
  vi.doMock('../src/services/sessionMemory.js', () => ({
    prepareSessionMemoryForSpawn: vi.fn(async () => ({
      repoId,
      memoryFiles: [],
    })),
  }));
  const spawnSessionOnHost = vi.fn(async () => ({
    session: child,
    cmd_id: 'spawn-command',
    queued: true,
    replayed: false,
  }));
  const queueInputToSession = vi.fn(async () => ({
    cmd_id: 'input-command',
    queued: true,
  }));
  vi.doMock('../src/services/sessionSpawn.js', () => ({
    spawnSessionOnHost,
    queueInputToSession,
  }));
  vi.doMock('../src/auth/verify.js', () => ({
    mintSessionToken: vi.fn(async () => ({
      token: 'child-session-token',
      expires_at: now,
    })),
  }));
  vi.doMock('../src/services/pubsub.js', () => ({
    pubsub: {
      publishSessionsChanged: vi.fn(),
      publishWorkItemUpdated: vi.fn(),
    },
  }));
  const claimWorkItemForSession = vi.fn(async () => workItem);
  const completeWorkItemForSession = vi.fn(async (input: { status: string }) => ({
    ...workItem,
    status: input.status,
  }));
  const createMemoryEntry = vi.fn(async (_user: string, input: Record<string, unknown>) => ({
    id: '77777777-7777-4777-8777-777777777777',
    user_id: userId,
    ...input,
  }));
  vi.doMock('../src/db/automationMemory.js', () => ({
    listWorkItemsForSession: vi.fn(async () => [workItem]),
    claimWorkItemForSession,
    completeWorkItemForSession,
    searchMemoryForSession: vi.fn(async () => []),
    createMemoryEntry,
  }));

  const { registerOrchestratorRoutes } = await import('../src/routes/orchestrator.js');
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => {
    request.user = {
      id: userId,
      sub: `session:${parentId}`,
      role: 'viewer',
      auth_type: 'session',
      session_id: parentId,
    } satisfies AuthUser;
  });
  registerOrchestratorRoutes(app);
  return {
    app,
    spawnSessionOnHost,
    queueInputToSession,
    claimWorkItemForSession,
    completeWorkItemForSession,
    createMemoryEntry,
  };
}

describe('session-scoped orchestrator routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('spawns a parent-linked worker through the durable path and mints its token', async () => {
    const { app, spawnSessionOnHost, queueInputToSession } = await buildServer();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orchestrator/spawn',
      headers: { 'idempotency-key': 'spawn-worker-1' },
      payload: {
        host_id: hostId,
        provider: 'codex',
        working_directory: '/workspace/repo',
        prompt: 'Implement the API',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(spawnSessionOnHost).toHaveBeenCalledWith(expect.objectContaining({
      parent_session_id: parentId,
      role: 'worker',
      host_id: hostId,
    }));
    expect(queueInputToSession).toHaveBeenCalledWith(expect.objectContaining({
      session_id: childId,
      text: 'Implement the API',
      enter: true,
      idempotencyKey: expect.stringContaining('orchestrator.spawn'),
    }));
    expect(response.json()).toMatchObject({
      session: { id: childId },
      queued: true,
      session_token: 'child-session-token',
    });
    await app.close();
  });

  it('lists only direct children and provides snapshot/status plus durable input', async () => {
    const { app, queueInputToSession } = await buildServer();
    const listed = await app.inject({ method: 'GET', url: '/v1/orchestrator/children' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      session_id: parentId,
      children: [{ id: childId }],
      rollup: { child_sessions: { total: 1 } },
    });

    const status = await app.inject({
      method: 'GET',
      url: `/v1/orchestrator/children/${childId}`,
    });
    expect(status.json()).toMatchObject({
      session: { id: childId, status: 'RUNNING' },
      snapshot: { capture_text: 'working' },
    });

    const sent = await app.inject({
      method: 'POST',
      url: `/v1/orchestrator/children/${childId}/input`,
      payload: { input: 'Continue', enter: false },
    });
    expect(sent.json()).toEqual({ cmd_id: 'input-command', queued: true });
    expect(queueInputToSession).toHaveBeenLastCalledWith({
      session_id: childId,
      text: 'Continue',
      enter: false,
    });
    await app.close();
  });

  it('claims/completes work and forces memory writes into caller scope', async () => {
    const {
      app,
      claimWorkItemForSession,
      completeWorkItemForSession,
      createMemoryEntry,
    } = await buildServer();
    const claimed = await app.inject({
      method: 'POST',
      url: '/v1/orchestrator/work-items/claim',
      payload: { work_item_id: workItemId },
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimWorkItemForSession).toHaveBeenCalledWith(expect.objectContaining({
      user_id: userId,
      session_id: parentId,
      repo_id: repoId,
    }));

    const completed = await app.inject({
      method: 'POST',
      url: `/v1/orchestrator/work-items/${workItemId}/complete`,
      payload: { status: 'done', result: { tests: 'passed' } },
    });
    expect(completed.statusCode).toBe(200);
    expect(completeWorkItemForSession).toHaveBeenCalledWith(expect.objectContaining({
      session_id: parentId,
      status: 'done',
      result: { tests: 'passed' },
    }));

    const memory = await app.inject({
      method: 'POST',
      url: '/v1/orchestrator/memory',
      payload: {
        scope_type: 'working',
        tier: 'working',
        summary: 'Current state',
        content: 'The focused tests pass.',
        session_id: childId,
      },
    });
    expect(memory.statusCode).toBe(200);
    expect(createMemoryEntry).toHaveBeenCalledWith(userId, expect.objectContaining({
      scope_type: 'working',
      session_id: parentId,
      repo_id: undefined,
      metadata: { source_session_id: parentId },
    }));
    await app.close();
  });
});
