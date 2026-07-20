import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@agent-command/schema';
import type { AuthUser } from '../src/auth/types.js';

const parentSessionId = '11111111-1111-4111-8111-111111111111';
const childSessionId = '22222222-2222-4222-8222-222222222222';
const hostId = '33333333-3333-4333-8333-333333333333';
const userId = '44444444-4444-4444-8444-444444444444';
const taskId = '55555555-5555-4555-8555-555555555555';
const now = '2026-07-19T16:00:00.000Z';

const parentSession: Session = {
  id: parentSessionId,
  host_id: hostId,
  kind: 'tmux_pane',
  provider: 'codex',
  status: 'RUNNING',
  role: 'orchestrator',
  title: 'Orchestrator',
  metadata: {},
  created_at: now,
  updated_at: now,
  fork_depth: 0,
};
const forkEdge = {
  parent_session_id: parentSessionId,
  child_session_id: childSessionId,
  edge_type: 'forked' as const,
  created_at: now,
};
const rollup = {
  session_id: parentSessionId,
  child_sessions: { total: 1, by_status: { RUNNING: 1 } },
  agent_tasks: { total: 1, running: 1, completed: 0, failed: 0 },
};
const agentTask = {
  id: taskId,
  session_id: parentSessionId,
  tool_use_id: 'toolu_01',
  description: 'Review contracts',
  status: 'running' as const,
  started_at: now,
  ended_at: null,
  metadata: {},
};

async function buildServer(): Promise<{
  app: FastifyInstance;
  dispatch: ReturnType<typeof vi.fn>;
  backfillForkEdges: ReturnType<typeof vi.fn>;
  publishSessionEdgesChanged: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  vi.doMock('../src/db/index.js', () => ({
    getSessionById: vi.fn(async (id: string) => id === parentSessionId ? parentSession : null),
    createAuditLog: vi.fn(async () => undefined),
  }));
  const backfillForkEdges = vi.fn(async () => [forkEdge]);
  vi.doMock('../src/db/sessionGraph.js', () => ({
    sessionGraph: {
      list: vi.fn(async () => [forkEdge]),
      rollup: vi.fn(async () => rollup),
      backfillForkEdges,
    },
  }));
  vi.doMock('../src/db/agentTasks.js', () => ({
    agentTasks: {
      list: vi.fn(async () => [agentTask]),
    },
  }));
  const dispatch = vi.fn(async () => true);
  vi.doMock('../src/services/commandRouter.js', () => ({
    commandRouter: { dispatch },
  }));
  vi.doMock('../src/services/sessionMemory.js', () => ({
    prepareSessionMemoryForSpawn: vi.fn(),
    bootstrapSessionMemory: vi.fn(),
  }));

  const { registerSessionRoutes } = await import('../src/routes/sessions.js');
  const { pubsub } = await import('../src/services/pubsub.js');
  const publishSessionEdgesChanged = vi.spyOn(pubsub, 'publishSessionEdgesChanged');
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => {
    request.user = {
      id: userId,
      sub: 'operator@example.test',
      role: 'operator',
      auth_type: 'jwt',
    } satisfies AuthUser;
  });
  registerSessionRoutes(app);
  return { app, dispatch, backfillForkEdges, publishSessionEdgesChanged };
}

describe('session graph routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns connected edges, status rollups, and in-process tasks', async () => {
    const { app } = await buildServer();

    const graphResponse = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${parentSessionId}/graph`,
    });
    expect(graphResponse.statusCode).toBe(200);
    expect(graphResponse.json()).toEqual({
      session_id: parentSessionId,
      edges: [forkEdge],
      rollup,
    });
    const tasksResponse = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${parentSessionId}/agent-tasks`,
    });
    expect(tasksResponse.statusCode).toBe(200);
    expect(tasksResponse.json()).toEqual({
      session_id: parentSessionId,
      agent_tasks: [agentTask],
    });
    await app.close();
  });

  it('backfills and publishes the fork edge after dispatching a fork', async () => {
    const {
      app,
      dispatch,
      backfillForkEdges,
      publishSessionEdgesChanged,
    } = await buildServer();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${parentSessionId}/fork`,
      payload: { note: 'child review' },
    });

    expect(response.statusCode).toBe(200);
    expect(dispatch).toHaveBeenCalledWith(
      hostId,
      parentSessionId,
      expect.any(String),
      { type: 'fork', payload: { note: 'child review' } }
    );
    expect(backfillForkEdges).toHaveBeenCalledWith(parentSessionId);
    expect(publishSessionEdgesChanged).toHaveBeenCalledWith(parentSessionId, [forkEdge]);
    await app.close();
  });

  it('returns 404 for graph reads when the session does not exist', async () => {
    const { app } = await buildServer();
    const missingId = '66666666-6666-4666-8666-666666666666';

    const response = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${missingId}/graph`,
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
