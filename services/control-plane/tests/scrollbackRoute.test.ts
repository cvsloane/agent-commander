import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/auth/types.js';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const dispatchAndWait = vi.fn(async () => ({
  ok: true,
  result: { content: 'captured scrollback' },
}));

function user(role: AuthUser['role'] = 'operator'): AuthUser {
  return {
    id: userId,
    sub: `${role}@example.test`,
    role,
    auth_type: 'jwt',
  };
}

async function buildServer(options: {
  role?: AuthUser['role'];
  hostCapable?: boolean;
} = {}) {
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
    createAuditLog: vi.fn(async () => undefined),
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

describe('session scrollback route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('dispatches a capped capture_pane request and returns its result', async () => {
    const app = await buildServer();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/scrollback`,
      payload: { mode: 'last_n', last_n_lines: 250 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      cmd_id: expect.any(String),
      ok: true,
      result: { content: 'captured scrollback' },
    });
    expect(dispatchAndWait).toHaveBeenCalledWith(
      hostId,
      sessionId,
      expect.any(String),
      {
        type: 'capture_pane',
        payload: { mode: 'last_n', last_n_lines: 250, strip_ansi: true },
      }
    );

    await app.close();
  });

  it('forwards an anchored continuation cursor and preserves its immutable page metadata', async () => {
    const app = await buildServer();
    dispatchAndWait.mockResolvedValueOnce({
      ok: true,
      result: {
        content: 'older\nnewer',
        line_count: 2,
        capture_mode: 'snapshot',
        snapshot_id: userId,
        range_start: 7_498,
        range_end: 7_500,
        total_lines: 8_000,
        source_total_lines: 8_000,
        snapshot_truncated: false,
        has_older: true,
        next_before: 7_498,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/scrollback`,
      payload: {
        mode: 'full',
        page_size: 500,
        snapshot_id: userId,
        before_line: 7_500,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result).toEqual({
      content: 'older\nnewer',
      line_count: 2,
      capture_mode: 'snapshot',
      snapshot_id: userId,
      range_start: 7_498,
      range_end: 7_500,
      total_lines: 8_000,
      source_total_lines: 8_000,
      snapshot_truncated: false,
      has_older: true,
      next_before: 7_498,
    });
    expect(dispatchAndWait).toHaveBeenCalledWith(
      hostId,
      sessionId,
      expect.any(String),
      {
        type: 'capture_pane',
        payload: {
          mode: 'full',
          page_size: 500,
          snapshot_id: userId,
          before_line: 7_500,
          strip_ansi: true,
        },
      },
    );

    await app.close();
  });

  it.each([
    [{ mode: 'last_n' }, 'last_n_lines'],
    [{ mode: 'range', start_line: -5000, end_line: 0 }, 'end_line'],
    [{ mode: 'range', start_line: -10 }, 'end_line'],
  ])('rejects invalid or over-cap requests %#', async (payload, issuePath) => {
    const app = await buildServer();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/scrollback`,
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain(issuePath);
    expect(dispatchAndWait).not.toHaveBeenCalled();
    await app.close();
  });

  it('requests a bounded initial snapshot page instead of transporting full live history', async () => {
    const app = await buildServer();
    dispatchAndWait.mockResolvedValueOnce({
      ok: true,
      result: {
        content: 'line-7997\nline-7998\nline-7999',
        line_count: 3,
        capture_mode: 'snapshot',
        snapshot_id: userId,
        range_start: 7_997,
        range_end: 8_000,
        total_lines: 8_000,
        source_total_lines: 8_000,
        snapshot_truncated: false,
        has_older: true,
        next_before: 7_997,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/scrollback`,
      payload: { mode: 'full', strip_ansi: false },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result).toMatchObject({
      content: 'line-7997\nline-7998\nline-7999',
      snapshot_id: userId,
      range_start: 7_997,
      range_end: 8_000,
      next_before: 7_997,
    });
    expect(dispatchAndWait).toHaveBeenCalledWith(
      hostId,
      sessionId,
      expect.any(String),
      { type: 'capture_pane', payload: { mode: 'full', page_size: 500, strip_ansi: false } }
    );
    await app.close();
  });

  it.each([
    ['last_n', { mode: 'last_n', last_n_lines: 5_000 }],
    ['range', { mode: 'range', start_line: -5_000, end_line: -1 }],
  ])('retains the response cap for legacy %s captures', async (captureMode, payload) => {
    const app = await buildServer();
    const content = Array.from({ length: 5_002 }, (_, index) => `line-${index}`).join('\n');
    dispatchAndWait.mockResolvedValueOnce({
      ok: true,
      result: { content, line_count: 5_002, capture_mode: captureMode },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/scrollback`,
      payload,
    });

    expect(response.statusCode).toBe(200);
    const result = response.json<{
      result: { content: string; line_count: number; truncated: boolean };
    }>().result;
    const lines = result.content.split('\n');
    expect(lines).toHaveLength(5_000);
    expect(lines[0]).toBe('line-2');
    expect(result.line_count).toBe(5_000);
    expect(result.truncated).toBe(true);
    await app.close();
  });

  it.each([
    [{ role: 'viewer' as const }, 'Forbidden'],
    [{ hostCapable: false }, 'Host does not support tmux terminal commands'],
  ])('rejects requests outside scrollback policy %#', async (options, error) => {
    const app = await buildServer(options);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/scrollback`,
      payload: { mode: 'visible' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error });
    expect(dispatchAndWait).not.toHaveBeenCalled();
    await app.close();
  });
});
