import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/auth/types.js';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const dispatchAndWait = vi.fn();
const createAuditLog = vi.fn(async () => undefined);

function user(role: AuthUser['role'] = 'operator'): AuthUser {
  return {
    id: userId,
    sub: `${role}@example.test`,
    role,
    auth_type: 'jwt',
  };
}

async function buildServer(options: { role?: AuthUser['role']; hostCapable?: boolean } = {}) {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('DATABASE_URL', 'postgres://agent-command:test@localhost:5432/agent_command_test');
  vi.doMock('../src/db/index.js', () => ({
    pool: { query: vi.fn(async () => ({ rows: [] })) },
    getSessionById: vi.fn(async () => ({ id: sessionId, host_id: hostId })),
    getHostById: vi.fn(async () => ({
      id: hostId,
      capabilities: {
        tmux: options.hostCapable ?? true,
        terminal: options.hostCapable ?? true,
      },
    })),
    createAuditLog,
  }));
  vi.doMock('../src/services/commandRouter.js', () => ({
    commandRouter: { dispatchAndWait },
  }));

  const { registerSessionRoutes } = await import('../src/routes/sessions.js');
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => {
    request.user = user(options.role);
  });
  registerSessionRoutes(app);
  return app;
}

describe('session transcript route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    dispatchAndWait.mockResolvedValue({
      ok: true,
      result: {
        entries: [{ type: 'user', message: { content: 'Ship it' } }],
        first_entry: 7,
        total_entries: 8,
        source: 'hook',
      },
    });
  });

  it('dispatches the bounded capture command and audits the transcript read', async () => {
    const app = await buildServer();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/transcript`,
      payload: { page_size: 250, before_entry: 42 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      cmd_id: expect.any(String),
      ok: true,
      result: { first_entry: 7, total_entries: 8, source: 'hook' },
    });
    expect(dispatchAndWait).toHaveBeenCalledWith(hostId, sessionId, expect.any(String), {
      type: 'capture_transcript',
      payload: { page_size: 250, before_entry: 42 },
    });
    expect(createAuditLog).toHaveBeenCalledWith(
      'session.transcript',
      'session',
      sessionId,
      { cmd_id: expect.any(String), request: { page_size: 250, before_entry: 42 } },
      userId
    );

    await app.close();
  });

  it('surfaces old-agent unknown-command failures without terminating the request', async () => {
    dispatchAndWait.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: 'unknown command type: capture_transcript',
      },
    });
    const app = await buildServer();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/transcript`,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      cmd_id: expect.any(String),
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: 'unknown command type: capture_transcript',
      },
    });
    expect(dispatchAndWait).toHaveBeenCalledWith(hostId, sessionId, expect.any(String), {
      type: 'capture_transcript',
      payload: { page_size: 200 },
    });
    expect(createAuditLog).toHaveBeenCalledWith(
      'session.transcript',
      'session',
      sessionId,
      { cmd_id: expect.any(String), request: { page_size: 200 } },
      userId
    );
    await app.close();
  });

  it.each([
    [{ page_size: 0 }, 'page_size'],
    [{ page_size: 501 }, 'page_size'],
    [{ before_entry: -1 }, 'before_entry'],
  ])('rejects invalid transcript bounds %#', async (payload, issuePath) => {
    const app = await buildServer();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/transcript`,
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain(issuePath);
    expect(dispatchAndWait).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    [{ role: 'viewer' as const }, 'Forbidden'],
    [{ hostCapable: false }, 'Host does not support tmux terminal commands'],
  ])('rejects requests outside transcript policy %#', async (options, error) => {
    const app = await buildServer(options);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/transcript`,
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error });
    expect(dispatchAndWait).not.toHaveBeenCalled();
    await app.close();
  });
});
