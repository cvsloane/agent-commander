import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@agent-command/schema';
import type { AuthUser } from '../src/auth/types.js';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const dispatch = vi.fn(async () => true);
let tmuxCapable = true;

function user(): AuthUser {
  return {
    id: userId,
    sub: 'operator@example.test',
    role: 'operator',
    auth_type: 'jwt',
  };
}

function session(): Session {
  return {
    id: sessionId,
    host_id: hostId,
    user_id: userId,
    repo_id: null,
    kind: 'tmux_pane',
    provider: 'codex',
    status: 'RUNNING',
    title: 'Codex',
    cwd: '/home/cvsloane/dev/agent-command',
    repo_root: '/home/cvsloane/dev/agent-command',
    git_remote: null,
    git_branch: 'main',
    tmux_pane_id: '%1',
    tmux_target: 'agents:0.0',
    metadata: null,
    created_at: '2026-05-19T17:00:00.000Z',
    updated_at: '2026-05-19T18:00:00.000Z',
    last_activity_at: '2026-05-19T18:00:00.000Z',
    idled_at: null,
    group_id: null,
    forked_from: null,
    fork_depth: 0,
    archived_at: null,
  };
}

describe('session command policy', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    tmuxCapable = true;
    vi.stubEnv('DATABASE_URL', 'postgres://agent-command:test@localhost:5432/agent_command_test');
    vi.doMock('../src/db/index.js', () => ({
      pool: { query: vi.fn(async () => ({ rows: [] })) },
      getSessionById: vi.fn(async () => session()),
      getHostById: vi.fn(async () => ({
        id: hostId,
        capabilities: { tmux: tmuxCapable, terminal: tmuxCapable },
      })),
      createAuditLog: vi.fn(async () => undefined),
    }));
    vi.doMock('../src/services/commandRouter.js', () => ({
      commandRouter: { dispatch },
    }));
  });

  it('blocks privileged commands from generic session command dispatch', async () => {
    const { registerSessionRoutes } = await import('../src/routes/sessions.js');
    const app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      request.user = user();
    });
    registerSessionRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/commands`,
      payload: {
        type: 'spawn_session',
        payload: {
          provider: 'codex',
          working_directory: '/home/cvsloane/dev/agent-command',
        },
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: 'spawn_session must use a dedicated policy-checked endpoint',
    });
    await app.close();
  });

  it.each([
    ['new_window', { window_name: 'scratch' }],
    ['kill_window', { window_index: 3 }],
    ['rename_window', { window_index: 3, name: 'builds' }],
    ['split_pane', { direction: 'vertical', percent: 50 }],
    ['select_window', { window_index: 2 }],
    ['select_pane', { pane_id: '%14' }],
    ['resize_pane', { pane_id: '%14', width: 120 }],
    ['zoom_pane', { pane_id: '%14' }],
  ])('dispatches policy-checked %s through the generic command route', async (type, payload) => {
    const { registerSessionRoutes } = await import('../src/routes/sessions.js');
    const app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      request.user = user();
    });
    registerSessionRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/commands`,
      payload: { type, payload },
    });

    expect(response.statusCode).toBe(200);
    expect(dispatch).toHaveBeenCalledWith(
      hostId,
      sessionId,
      expect.any(String),
      { type, payload }
    );
    await app.close();
  });

  it('rejects tmux commands when the host lacks tmux terminal capability', async () => {
    tmuxCapable = false;
    const { registerSessionRoutes } = await import('../src/routes/sessions.js');
    const app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      request.user = user();
    });
    registerSessionRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/commands`,
      payload: { type: 'select_pane', payload: { pane_id: '%14' } },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Host does not support tmux terminal commands' });
    expect(dispatch).not.toHaveBeenCalled();
    await app.close();
  });
});
