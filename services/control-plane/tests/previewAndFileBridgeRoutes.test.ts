import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Host, Session } from '@agent-command/schema';
import type { AuthUser } from '../src/auth/types.js';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';

function user(role: AuthUser['role']): AuthUser {
  return { id: userId, sub: `${role}@example.test`, role, auth_type: 'jwt' };
}

function host(capabilities: Record<string, unknown>): Host {
  return {
    id: hostId,
    name: 'heavisidelinux',
    tailscale_name: 'heavisidelinux',
    tailscale_ip: '100.67.212.40',
    capabilities: { tmux: true, terminal: true, ...capabilities },
    agent_version: 'test',
    last_seen_at: '2026-07-26T18:00:00.000Z',
    last_acked_seq: 10,
    created_at: '2026-07-26T17:00:00.000Z',
    updated_at: '2026-07-26T18:00:00.000Z',
  } as Host;
}

function session(): Session {
  return {
    id: sessionId,
    host_id: hostId,
    user_id: userId,
    repo_id: null,
    kind: 'tmux_pane',
    provider: 'claude_code',
    status: 'RUNNING',
    title: 'agent',
    cwd: '/home/cvsloane/dev/agent-command',
    repo_root: '/home/cvsloane/dev/agent-command',
    git_remote: null,
    git_branch: 'main',
    tmux_pane_id: '%1',
    tmux_target: 'agents:0.0',
    metadata: null,
    created_at: '2026-07-26T17:00:00.000Z',
    updated_at: '2026-07-26T18:00:00.000Z',
    last_activity_at: '2026-07-26T18:00:00.000Z',
    idled_at: null,
    group_id: null,
    forked_from: null,
    fork_depth: 0,
    archived_at: null,
  } as Session;
}

type BuildOptions = {
  capabilities?: Record<string, unknown>;
  online?: boolean;
  commandResult?: unknown;
  commandOk?: boolean;
};

async function buildHostServer(role: AuthUser['role'], options: BuildOptions = {}) {
  vi.resetModules();
  vi.stubEnv('DATABASE_URL', 'postgres://agent-command:test@localhost:5432/agent_command_test');

  const dispatchHostAndWait = vi.fn(async () => ({
    ok: options.commandOk ?? true,
    result: options.commandResult,
    error: options.commandOk === false ? { message: 'agent failed', code: 'EFAIL' } : undefined,
  }));

  vi.doMock('../src/db/index.js', () => ({
    getHosts: vi.fn(async () => []),
    getHostById: vi.fn(async () => host(options.capabilities ?? {})),
    getOrphanPanes: vi.fn(async () => []),
    getLatestSnapshots: vi.fn(async () => []),
    createAuditLog: vi.fn(async () => undefined),
  }));
  vi.doMock('../src/services/commandRouter.js', () => ({
    commandRouter: { dispatchHostAndWait, dispatchAndWait: vi.fn() },
  }));
  vi.doMock('../src/services/hostPresence.js', () => ({
    isHostOnline: vi.fn(() => options.online ?? true),
    getHostPresence: vi.fn(() => []),
  }));

  const { registerHostRoutes } = await import('../src/routes/hosts.js');
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => {
    request.user = user(role);
  });
  registerHostRoutes(app);
  return { app, dispatchHostAndWait };
}

async function buildSessionServer(role: AuthUser['role'], options: BuildOptions = {}) {
  vi.resetModules();
  vi.stubEnv('DATABASE_URL', 'postgres://agent-command:test@localhost:5432/agent_command_test');

  const dispatchAndWait = vi.fn(async () => ({
    ok: options.commandOk ?? true,
    result: options.commandResult,
    error: options.commandOk === false ? { message: 'agent failed', code: 'EFAIL' } : undefined,
  }));

  vi.doMock('../src/db/index.js', () => ({
    getSessionById: vi.fn(async () => session()),
    getHostById: vi.fn(async () => host(options.capabilities ?? {})),
    getSessions: vi.fn(async () => []),
    getSessionsPage: vi.fn(async () => ({ sessions: [], total: 0 })),
    getLatestSnapshots: vi.fn(async () => []),
    createAuditLog: vi.fn(async () => undefined),
    // sessions.ts reaches the pool directly for a few queries; the routes under
    // test never touch it, but the module-level import must resolve.
    pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
  }));
  vi.doMock('../src/services/commandRouter.js', () => ({
    commandRouter: { dispatchAndWait, dispatchHostAndWait: vi.fn() },
  }));

  const { registerSessionRoutes } = await import('../src/routes/sessions.js');
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => {
    request.user = user(role);
  });
  registerSessionRoutes(app);
  return { app, dispatchAndWait };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('GET /v1/hosts/:id/ports', () => {
  it('returns discovered ports alongside the tailnet address', async () => {
    const { app } = await buildHostServer('operator', {
      capabilities: { preview_ports: true },
      commandResult: {
        ports: [
          { port: 3000, address: '0.0.0.0', loopback: false, pid: 42, process: 'node' },
          { port: 5173, address: '127.0.0.1', loopback: true },
        ],
      },
    });

    const response = await app.inject({ method: 'GET', url: `/v1/hosts/${hostId}/ports` });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    // The tailnet address is what makes a preview link work; it comes from the
    // host record rather than the agent so the two cannot drift.
    expect(body.tailscale_ip).toBe('100.67.212.40');
    expect(body.ports).toHaveLength(2);
    expect(body.ports[0]).toMatchObject({ port: 3000, loopback: false, process: 'node' });
    // A loopback listener must survive to the client so the UI can explain why
    // it is not linkable rather than offering a dead link.
    expect(body.ports[1]).toMatchObject({ port: 5173, loopback: true });
    await app.close();
  });

  it('refuses when the host has not enabled port preview', async () => {
    const { app, dispatchHostAndWait } = await buildHostServer('operator', { capabilities: {} });
    const response = await app.inject({ method: 'GET', url: `/v1/hosts/${hostId}/ports` });
    expect(response.statusCode).toBe(403);
    expect(dispatchHostAndWait).not.toHaveBeenCalled();
    await app.close();
  });

  it('refuses viewers', async () => {
    const { app } = await buildHostServer('viewer', { capabilities: { preview_ports: true } });
    const response = await app.inject({ method: 'GET', url: `/v1/hosts/${hostId}/ports` });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('reports the host as unavailable when the agent is offline', async () => {
    const { app } = await buildHostServer('operator', {
      capabilities: { preview_ports: true },
      online: false,
    });
    const response = await app.inject({ method: 'GET', url: `/v1/hosts/${hostId}/ports` });
    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it('rejects a malformed agent response rather than passing it through', async () => {
    const { app } = await buildHostServer('operator', {
      capabilities: { preview_ports: true },
      commandResult: { ports: 'not-an-array' },
    });
    const response = await app.inject({ method: 'GET', url: `/v1/hosts/${hostId}/ports` });
    expect(response.statusCode).toBe(500);
    await app.close();
  });
});

describe('GET /v1/hosts/:id/drop-files', () => {
  it('lists files waiting in the sync folder', async () => {
    const { app } = await buildHostServer('operator', {
      capabilities: { file_bridge: true },
      commandResult: {
        files: [{ name: 'mockup.png', size_bytes: 2048, modified_at: '2026-07-26T18:00:00Z' }],
        drop_dir: '/home/cvsloane/Nextcloud/AgentDrop',
        max_file_bytes: 67108864,
      },
    });

    const response = await app.inject({ method: 'GET', url: `/v1/hosts/${hostId}/drop-files` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      drop_dir: '/home/cvsloane/Nextcloud/AgentDrop',
      files: [{ name: 'mockup.png', size_bytes: 2048 }],
    });
    await app.close();
  });

  it('refuses when the host has no file bridge', async () => {
    const { app } = await buildHostServer('operator', { capabilities: {} });
    const response = await app.inject({ method: 'GET', url: `/v1/hosts/${hostId}/drop-files` });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

describe('POST /v1/sessions/:id/attach-file', () => {
  it('attaches a dropped file and returns where it landed', async () => {
    const { app, dispatchAndWait } = await buildSessionServer('operator', {
      capabilities: { file_bridge: true },
      commandResult: {
        path: '/home/cvsloane/dev/agent-command/mockup.png',
        name: 'mockup.png',
        size_bytes: 2048,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/attach-file`,
      payload: { name: 'mockup.png' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: 'mockup.png', size_bytes: 2048 });
    expect(dispatchAndWait).toHaveBeenCalledWith(
      hostId,
      sessionId,
      expect.any(String),
      { type: 'attach_drop_file', payload: { name: 'mockup.png' } }
    );
    await app.close();
  });

  it('rejects an empty file name before dispatching', async () => {
    const { app, dispatchAndWait } = await buildSessionServer('operator', {
      capabilities: { file_bridge: true },
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/attach-file`,
      payload: { name: '' },
    });
    expect(response.statusCode).toBe(400);
    expect(dispatchAndWait).not.toHaveBeenCalled();
    await app.close();
  });

  it('refuses when the host has no file bridge', async () => {
    const { app, dispatchAndWait } = await buildSessionServer('operator', { capabilities: {} });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/attach-file`,
      payload: { name: 'mockup.png' },
    });
    expect(response.statusCode).toBe(403);
    expect(dispatchAndWait).not.toHaveBeenCalled();
    await app.close();
  });

  it('refuses viewers', async () => {
    const { app } = await buildSessionServer('viewer', { capabilities: { file_bridge: true } });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/attach-file`,
      payload: { name: 'mockup.png' },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('surfaces an agent-side rejection as a failure', async () => {
    const { app } = await buildSessionServer('operator', {
      capabilities: { file_bridge: true },
      commandOk: false,
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/attach-file`,
      payload: { name: '../../etc/passwd' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json().error).toBe('agent failed');
    await app.close();
  });
});

describe('POST /v1/sessions/:id/publish-file', () => {
  it('publishes a produced file to the outbound folder', async () => {
    const { app, dispatchAndWait } = await buildSessionServer('operator', {
      capabilities: { file_bridge: true },
      commandResult: {
        path: '/home/cvsloane/Nextcloud/AgentOut/report.md',
        name: 'report.md',
        size_bytes: 128,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/publish-file`,
      payload: { path: '/home/cvsloane/dev/agent-command/report.md' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().path).toContain('AgentOut');
    expect(dispatchAndWait).toHaveBeenCalled();
    await app.close();
  });

  it('requires a path', async () => {
    const { app } = await buildSessionServer('operator', { capabilities: { file_bridge: true } });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/publish-file`,
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
