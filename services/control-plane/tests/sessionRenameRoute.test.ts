import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/auth/types.js';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';

const session = {
  id: sessionId,
  host_id: hostId,
  user_id: userId,
  kind: 'tmux_pane',
  provider: 'codex',
  status: 'RUNNING',
  title: 'Renamed session',
  metadata: {},
  created_at: '2026-07-20T18:00:00.000Z',
  updated_at: '2026-07-20T18:01:00.000Z',
  fork_depth: 0,
};
const dispatch = vi.fn(async () => true);

function operator(): AuthUser {
  return {
    id: userId,
    sub: 'operator@example.test',
    role: 'operator',
    auth_type: 'jwt',
  };
}

async function buildServer(options: { connected?: boolean } = {}) {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('DATABASE_URL', 'postgres://agent-command:test@localhost:5432/agent_command_test');
  const updateSession = vi.fn(async () => session);
  vi.doMock('../src/db/index.js', () => ({
    pool: { query: vi.fn(async () => ({ rows: [] })) },
    updateSession,
    createAuditLog: vi.fn(async () => undefined),
  }));
  vi.doMock('../src/services/commandRouter.js', () => ({
    commandRouter: { dispatch },
  }));
  const isAgentConnected = vi.fn(() => options.connected ?? true);
  vi.doMock('../src/services/pubsub.js', () => ({
    pubsub: {
      isAgentConnected,
      publishSessionsChanged: vi.fn(),
    },
  }));

  const { registerSessionRoutes } = await import('../src/routes/sessions.js');
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => {
    request.user = operator();
  });
  registerSessionRoutes(app);
  return { app, updateSession, isAgentConnected };
}

describe('PATCH /v1/sessions/:id title synchronization', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('persists the title before dispatching rename_session to a connected owning agent', async () => {
    const { app, updateSession, isAgentConnected } = await buildServer();

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/sessions/${sessionId}`,
      payload: { title: 'Renamed session' },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(updateSession).toHaveBeenCalledWith(sessionId, { title: 'Renamed session' });
    expect(isAgentConnected).toHaveBeenCalledWith(hostId);
    expect(dispatch).toHaveBeenCalledWith(
      hostId,
      sessionId,
      expect.any(String),
      { type: 'rename_session', payload: { title: 'Renamed session' } }
    );
    expect(updateSession.mock.invocationCallOrder[0]).toBeLessThan(
      dispatch.mock.invocationCallOrder[0]!
    );
    expect(response.json()).toEqual({ session });
    await app.close();
  });

  it('keeps the database update successful when the agent is offline', async () => {
    const { app } = await buildServer({ connected: false });

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/sessions/${sessionId}`,
      payload: { title: 'Renamed session' },
    });

    expect(response.statusCode).toBe(200);
    expect(dispatch).not.toHaveBeenCalled();
    await app.close();
  });

  it('keeps the database update successful if the connected agent drops during dispatch', async () => {
    dispatch.mockResolvedValueOnce(false);
    const { app } = await buildServer();

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/sessions/${sessionId}`,
      payload: { title: 'Renamed session' },
    });

    expect(response.statusCode).toBe(200);
    expect(dispatch).toHaveBeenCalledOnce();
    await app.close();
  });
});
