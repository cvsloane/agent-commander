import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Host, Session } from '@agent-command/schema';
import type { AuthUser } from '../src/auth/types.js';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';

function user(role: AuthUser['role']): AuthUser {
  return {
    id: userId,
    sub: `${role}@example.test`,
    role,
    auth_type: 'jwt',
  };
}

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: hostId,
    name: 'heavisidelinux',
    tailscale_name: 'heavisidelinux',
    tailscale_ip: '100.64.0.10',
    capabilities: {
      tmux: true,
      terminal: true,
    },
    agent_version: 'test',
    last_seen_at: '2026-05-19T18:00:00.000Z',
    last_acked_seq: 10,
    created_at: '2026-05-19T17:00:00.000Z',
    updated_at: '2026-05-19T18:00:00.000Z',
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: sessionId,
    host_id: hostId,
    user_id: userId,
    repo_id: null,
    kind: 'tmux_pane',
    provider: 'codex',
    status: 'RUNNING',
    title: 'Codex implementation',
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
    ...overrides,
  };
}

async function buildServer(role: AuthUser['role'], options: {
  host?: Host | null;
  sessions?: Session[];
  refreshedSession?: Session | null;
} = {}): Promise<{
  app: FastifyInstance;
  adoptOrphanPanes: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  vi.stubEnv('DATABASE_URL', 'postgres://agent-command:test@localhost:5432/agent_command_test');

  const testHost = options.host === undefined ? host() : options.host;
  const testSessions = options.sessions ?? [session()];
  const refreshedSession = options.refreshedSession === undefined ? testSessions[0] : options.refreshedSession;
  const adoptOrphanPanes = vi.fn(async (sessionIds: string[]) => ({ adopted: sessionIds, errors: [] }));

  vi.doMock('../src/db/index.js', () => ({
    getHosts: vi.fn(async () => (testHost ? [testHost] : [])),
    getHostById: vi.fn(async () => testHost),
    getTmuxRosterSessions: vi.fn(async () => testSessions),
    adoptOrphanPanes,
    getSessionById: vi.fn(async () => refreshedSession),
    createAuditLog: vi.fn(async () => undefined),
  }));

  const { registerTmuxRoutes } = await import('../src/routes/tmux.js');
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => {
    request.user = user(role);
  });
  registerTmuxRoutes(app);

  return { app, adoptOrphanPanes };
}

describe('tmux open route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('opens a tracked tmux target by host alias', async () => {
    const { app, adoptOrphanPanes } = await buildServer('operator');

    const response = await app.inject({
      method: 'POST',
      url: '/v1/tmux/open',
      payload: {
        host_alias: 'heavisidelinux',
        tmux_target: 'agents:0.0',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      session_id: sessionId,
      adopted: false,
      terminal: { openable: true, pane_id: '%1' },
      href: `/tmux?host_id=${hostId}&session_id=${sessionId}&mode=terminal&attach=1`,
    });
    expect(adoptOrphanPanes).not.toHaveBeenCalled();
    await app.close();
  });

  it('adopts unmanaged panes before returning the terminal URL', async () => {
    const unmanaged = session({ metadata: { unmanaged: true } });
    const managed = session({ metadata: { unmanaged: false } });
    const { app, adoptOrphanPanes } = await buildServer('operator', {
      sessions: [unmanaged],
      refreshedSession: managed,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/tmux/open',
      payload: {
        host_id: hostId,
        pane_id: '%1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ session_id: sessionId, adopted: true });
    expect(adoptOrphanPanes).toHaveBeenCalledWith([sessionId]);
    await app.close();
  });

  it('rejects viewers and unknown targets', async () => {
    const viewer = await buildServer('viewer');
    const viewerResponse = await viewer.app.inject({
      method: 'POST',
      url: '/v1/tmux/open',
      payload: { host_id: hostId, tmux_target: 'agents:0.0' },
    });
    expect(viewerResponse.statusCode).toBe(403);
    await viewer.app.close();

    const operator = await buildServer('operator', { sessions: [] });
    const missingResponse = await operator.app.inject({
      method: 'POST',
      url: '/v1/tmux/open',
      payload: { host_id: hostId, tmux_target: 'missing:0.0' },
    });
    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.json()).toMatchObject({ error: 'Tmux pane not found' });
    await operator.app.close();
  });
});
