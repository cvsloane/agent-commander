import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Host, Session } from '@agent-command/schema';
import type { AuthUser } from '../src/auth/types.js';

const hostId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const parentSessionId = '33333333-3333-4333-8333-333333333333';

function host(): Host {
  return {
    id: hostId,
    name: 'test-host',
    capabilities: {
      tmux: true,
      spawn: true,
      kill: true,
      console_stream: true,
      terminal: true,
      claude_hooks: false,
      codex_exec_json: true,
      list_directory: false,
      list_directory_roots: [],
      list_directory_show_hidden: false,
      providers: { codex: true },
    },
    agent_version: 'test',
    last_seen_at: new Date().toISOString(),
    last_acked_seq: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeSession(data: Partial<Session>): Session {
  return {
    id: data.id!,
    host_id: hostId,
    user_id: userId,
    repo_id: null,
    kind: 'tmux_pane',
    provider: 'codex',
    status: 'STARTING',
    title: 'Codex',
    cwd: '/tmp',
    repo_root: null,
    git_remote: null,
    git_branch: null,
    tmux_pane_id: null,
    tmux_target: null,
    metadata: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_activity_at: null,
    idled_at: null,
    group_id: null,
    forked_from: null,
    fork_depth: 0,
    archived_at: null,
    ...data,
  };
}

async function buildServer(options: {
  hideIdempotencyLookup?: boolean;
  withParentSession?: boolean;
  edgeError?: Error;
} = {}): Promise<{
  app: FastifyInstance;
  send: ReturnType<typeof vi.fn>;
  enqueue: ReturnType<typeof vi.fn>;
  deleteSession: ReturnType<typeof vi.fn>;
  upsertEdge: ReturnType<typeof vi.fn>;
  setRole: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const sessions = new Map<string, Session>();
  if (options.withParentSession) {
    sessions.set(parentSessionId, makeSession({
      id: parentSessionId,
      status: 'RUNNING',
      role: 'orchestrator',
    }));
  }
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
        options.hideIdempotencyLookup ? null : idempotentRecords.get(key) ?? null
      )),
      markSent: vi.fn(async (_hostId: string, cmdId: string) => ({
        cmd_id: cmdId,
        status: 'sent',
      })),
      markQueued: vi.fn(async () => null),
      markCompleted: vi.fn(async () => null),
      markFailed: vi.fn(async () => null),
      listDeliverable: vi.fn(async () => []),
      expireStale: vi.fn(async () => []),
      pruneTerminal: vi.fn(async () => 0),
    },
    decideApprovalAndEnqueue: vi.fn(),
  }));
  const createAuditLog = vi.fn(async () => undefined);
  const deleteSession = vi.fn(async (id: string) => sessions.delete(id));
  vi.doMock('../src/db/index.js', () => ({
    getHostById: vi.fn(async () => host()),
    upsertSession: vi.fn(async (_hostId: string, data: Partial<Session>) => {
      const next = makeSession(data);
      sessions.set(next.id, next);
      return next;
    }),
    getSessionById: vi.fn(async (id: string) => sessions.get(id) ?? null),
    touchProject: vi.fn(async () => undefined),
    assignSessionGroup: vi.fn(async () => null),
    deleteSession,
    createAuditLog,
  }));
  const upsertEdge = vi.fn(async (input: Record<string, unknown>) => ({
    edge: {
      ...input,
      created_at: new Date().toISOString(),
    },
    created: true,
  }));
  if (options.edgeError) {
    upsertEdge.mockRejectedValue(options.edgeError);
  }
  const setRole = vi.fn(async (sessionId: string, role: Session['role']) => {
    const existing = sessions.get(sessionId);
    if (!existing) return null;
    const updated = { ...existing, role };
    sessions.set(sessionId, updated);
    return updated;
  });
  vi.doMock('../src/db/sessionGraph.js', () => ({
    sessionGraph: {
      upsert: upsertEdge,
      setRole,
      backfillForkEdges: vi.fn(async () => []),
    },
  }));
  vi.doMock('../src/db/agentTasks.js', () => ({
    agentTasks: { list: vi.fn(async () => []) },
  }));
  vi.doMock('../src/services/sessionMemory.js', () => ({
    prepareSessionMemoryForSpawn: vi.fn(async () => ({ repoId: null, memoryFiles: [] })),
    bootstrapSessionMemory: vi.fn(async () => undefined),
  }));

  const { registerSessionRoutes } = await import('../src/routes/sessions.js');
  const { pubsub } = await import('../src/services/pubsub.js');
  const send = vi.fn();
  const socket = { send };
  pubsub.addAgentConnection(hostId, socket as never);
  pubsub.markAgentReady(hostId, socket as never);
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
  return { app, send, enqueue, deleteSession, upsertEdge, setRole };
}

describe('session spawn route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the original session when the idempotency precheck loses a race', async () => {
    const { app, send, enqueue, deleteSession } = await buildServer({
      hideIdempotencyLookup: true,
    });
    const request = {
      method: 'POST' as const,
      url: '/v1/sessions/spawn',
      headers: { 'idempotency-key': 'spawn-once' },
      payload: {
        host_id: hostId,
        provider: 'codex',
        working_directory: '/tmp',
      },
    };

    const first = await app.inject(request);
    const second = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      cmd_id: first.json().cmd_id,
      session: { id: first.json().session.id },
    });
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledOnce();
    expect(deleteSession).toHaveBeenCalledOnce();
    await app.close();
  });

  it('rejects reuse of an Idempotency-Key with a different spawn request', async () => {
    const { app, send, enqueue, deleteSession } = await buildServer({
      hideIdempotencyLookup: true,
    });
    const baseRequest = {
      method: 'POST' as const,
      url: '/v1/sessions/spawn',
      headers: { 'idempotency-key': 'spawn-once' },
      payload: {
        host_id: hostId,
        provider: 'codex',
        working_directory: '/tmp',
      },
    };

    const first = await app.inject(baseRequest);
    const conflict = await app.inject({
      ...baseRequest,
      payload: { ...baseRequest.payload, working_directory: '/different' },
    });

    expect(first.statusCode).toBe(200);
    expect(conflict.statusCode).toBe(409);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledOnce();
    expect(deleteSession).toHaveBeenCalledOnce();
    await app.close();
  });

  it('returns 400 for an overlong Idempotency-Key', async () => {
    const { app, enqueue } = await buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/sessions/spawn',
      headers: { 'idempotency-key': 'x'.repeat(256) },
      payload: {
        host_id: hostId,
        provider: 'codex',
        working_directory: '/tmp',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
    await app.close();
  });

  it('persists and publishes parent linkage and role for a spawned worker session', async () => {
    const { app, send, upsertEdge, setRole } = await buildServer({
      withParentSession: true,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/sessions/spawn',
      payload: {
        host_id: hostId,
        provider: 'codex',
        working_directory: '/tmp',
        parent_session_id: parentSessionId,
        role: 'worker',
      },
    });

    expect(response.statusCode).toBe(200);
    const childSessionId = response.json().session.id;
    expect(response.json().session.role).toBe('worker');
    expect(setRole).toHaveBeenCalledWith(childSessionId, 'worker');
    expect(upsertEdge).toHaveBeenCalledWith({
      parent_session_id: parentSessionId,
      child_session_id: childSessionId,
      edge_type: 'spawned',
    });
    expect(JSON.parse(String(send.mock.calls[0]?.[0]))).toMatchObject({
      payload: {
        command: {
          type: 'spawn_session',
          payload: {
            parent_session_id: parentSessionId,
            role: 'worker',
          },
        },
      },
    });
    await app.close();
  });

  it('does not dispatch a spawn when parent-edge persistence fails', async () => {
    const { app, send } = await buildServer({
      withParentSession: true,
      edgeError: new Error('session_edges unavailable'),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/sessions/spawn',
      payload: {
        host_id: hostId,
        provider: 'codex',
        working_directory: '/tmp',
        parent_session_id: parentSessionId,
        role: 'worker',
      },
    });

    expect(response.statusCode).toBe(500);
    expect(send).not.toHaveBeenCalled();
    await app.close();
  });
});
