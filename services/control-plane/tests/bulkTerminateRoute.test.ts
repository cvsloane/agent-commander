import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/auth/types.js';

const hostId = '11111111-1111-4111-8111-111111111111';
const successfulSessionId = '22222222-2222-4222-8222-222222222222';
const failedSessionId = '33333333-3333-4333-8333-333333333333';
const timedOutSessionId = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';
const dispatch = vi.fn(async () => true);
const dispatchAndWait = vi.fn();
const archiveSessions = vi.fn(async () => undefined);
const createAuditLog = vi.fn(async () => undefined);

function user(): AuthUser {
  return {
    id: userId,
    sub: 'operator@example.test',
    role: 'operator',
    auth_type: 'jwt',
  };
}

async function buildServer() {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('DATABASE_URL', 'postgres://agent-command:test@localhost:5432/agent_command_test');
  vi.doMock('../src/db/index.js', () => ({
    pool: { query: vi.fn(async () => ({ rows: [] })) },
    getSessionsByIds: vi.fn(async () => [
      { id: successfulSessionId, host_id: hostId },
      { id: failedSessionId, host_id: hostId },
      { id: timedOutSessionId, host_id: hostId },
    ]),
    archiveSessions,
    createAuditLog,
  }));
  vi.doMock('../src/services/commandRouter.js', () => ({
    commandRouter: { dispatch, dispatchAndWait },
  }));

  const { registerSessionRoutes } = await import('../src/routes/sessions.js');
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => {
    request.user = user();
  });
  registerSessionRoutes(app);
  return app;
}

describe('bulk terminate route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('dispatches bounded kills concurrently and archives only confirmed successes', async () => {
    let resolveSuccessfulKill!: (result: { ok: true }) => void;
    const successfulKill = new Promise<{ ok: true }>((resolve) => {
      resolveSuccessfulKill = resolve;
    });
    dispatchAndWait
      .mockImplementationOnce(async () => successfulKill)
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'KILL_FAILED',
          message: 'tmux pane is still busy',
        },
      })
      .mockRejectedValueOnce(new Error('Command timed out'));
    const app = await buildServer();

    const responsePromise = app.inject({
      method: 'POST',
      url: '/v1/sessions/bulk',
      payload: {
        operation: 'terminate',
        session_ids: [successfulSessionId, failedSessionId, timedOutSessionId],
      },
    });

    await vi.waitFor(() => expect(dispatchAndWait).toHaveBeenCalledTimes(3));
    expect(archiveSessions).not.toHaveBeenCalled();
    expect(dispatchAndWait.mock.calls.map((call) => call[4])).toEqual([
      12_000,
      12_000,
      12_000,
    ]);
    resolveSuccessfulKill({ ok: true });

    const response = await responsePromise;

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      operation: 'terminate',
      success_count: 1,
      error_count: 2,
      errors: [
        { session_id: failedSessionId, error: 'tmux pane is still busy' },
        { session_id: timedOutSessionId, error: 'Command timed out' },
      ],
    });
    expect(dispatchAndWait).toHaveBeenNthCalledWith(
      1,
      hostId,
      successfulSessionId,
      expect.any(String),
      { type: 'kill_session', payload: {} },
      12_000
    );
    expect(archiveSessions).toHaveBeenCalledOnce();
    expect(archiveSessions).toHaveBeenCalledWith([successfulSessionId]);

    await app.close();
  });
});
