import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Host, Project, Session } from '@agent-command/schema';
import type { AuthUser } from '../src/auth/types.js';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const parentSessionId = '66666666-6666-4666-8666-666666666666';

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
      spawn: true,
      kill: true,
      console_stream: true,
      terminal: true,
      claude_hooks: true,
      codex_exec_json: true,
      list_directory: true,
      list_directory_roots: ['/home/cvsloane/dev'],
      list_directory_show_hidden: false,
      providers: { codex: true, claude_code: true },
    },
    agent_version: 'test',
    last_seen_at: new Date().toISOString(),
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
    status: 'STARTING',
    title: 'codex session',
    cwd: '/home/cvsloane/dev/agent-command',
    repo_root: '/home/cvsloane/dev/agent-command',
    git_remote: null,
    git_branch: 'main',
    tmux_pane_id: null,
    tmux_target: null,
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

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    user_id: userId,
    host_id: hostId,
    path: '/home/cvsloane/dev/agent-command',
    display_name: 'agent-command',
    description: null,
    last_used_at: '2026-05-19T18:00:00.000Z',
    usage_count: 3,
    git_remote: null,
    default_branch: 'main',
    created_at: '2026-05-19T17:00:00.000Z',
    updated_at: '2026-05-19T18:00:00.000Z',
    ...overrides,
  };
}

async function buildServer(role: AuthUser['role'], options: {
  host?: Host | null;
  sessionSequence?: Session[];
  agentConnected?: boolean;
} = {}): Promise<{
  app: FastifyInstance;
  agentSend: ReturnType<typeof vi.fn>;
  upsertEdge: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  vi.stubEnv('DATABASE_URL', 'postgres://agent-command:test@localhost:5432/agent_command_test');

  const commandRecords = new Map<string, Record<string, unknown>>();
  const idempotentRecords = new Map<string, Record<string, unknown>>();
  vi.doMock('../src/db/commandOutbox.js', () => ({
    commandOutbox: {
      enqueue: vi.fn(async (input: Record<string, unknown>) => {
        const idempotencyKey = typeof input.idempotency_key === 'string'
          ? input.idempotency_key
          : null;
        if (idempotencyKey && idempotentRecords.has(idempotencyKey)) {
          return { record: idempotentRecords.get(idempotencyKey), created: false };
        }
        const record = {
          ...input,
          status: 'queued',
          payload: input.payload,
          idempotency_key: input.idempotency_key ?? null,
        };
        commandRecords.set(String(input.cmd_id), record);
        if (idempotencyKey) idempotentRecords.set(idempotencyKey, record);
        return { record, created: true };
      }),
      getByIdForHost: vi.fn(async () => null),
      getByIdempotencyKey: vi.fn(async (_hostId: string, key: string) => (
        idempotentRecords.get(key) ?? null
      )),
      markSent: vi.fn(async (_hostId: string, cmdId: string) => ({
        ...commandRecords.get(cmdId),
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

  const testHost = options.host === undefined ? host() : options.host;
  const sessions = options.sessionSequence ?? [
    session(),
    session({ status: 'RUNNING', tmux_pane_id: '%1', tmux_target: 'agent-command:0.0' }),
  ];
  let getSessionCall = 0;

  vi.doMock('../src/db/index.js', () => ({
    getHosts: vi.fn(async () => (testHost ? [testHost] : [])),
    getHostById: vi.fn(async () => testHost),
    getProjects: vi.fn(async () => [project()]),
    getRecentLaunches: vi.fn(async () => [{
      id: '55555555-5555-4555-8555-555555555555',
      host_id: hostId,
      provider: 'codex',
      working_directory: '/home/cvsloane/dev/agent-command',
      tmux_target: 'agents',
      title: 'Codex session',
      launch_count: 2,
      last_launched_at: '2026-05-19T18:00:00.000Z',
    }]),
    getTmuxRosterSessions: vi.fn(async () => [
      session({
        status: 'RUNNING',
        tmux_pane_id: '%9',
        tmux_target: 'agents:1.0',
        title: 'Existing Codex',
      }),
    ]),
    upsertSession: vi.fn(async (_hostId: string, data: Partial<Session>) => session(data)),
    touchProject: vi.fn(async () => undefined),
    assignSessionGroup: vi.fn(async () => null),
    recordRecentLaunch: vi.fn(async () => ({
      id: '55555555-5555-4555-8555-555555555555',
      host_id: hostId,
      provider: 'codex',
      working_directory: '/home/cvsloane/dev/agent-command',
      tmux_target: 'agents',
      title: 'Codex session',
      launch_count: 2,
      last_launched_at: '2026-05-19T18:00:00.000Z',
    })),
    createAuditLog: vi.fn(async () => undefined),
    getSessionById: vi.fn(async () => {
      const next = sessions[Math.min(getSessionCall, sessions.length - 1)];
      getSessionCall += 1;
      return next;
    }),
  }));

  vi.doMock('../src/services/sessionMemory.js', () => ({
    prepareSessionMemoryForSpawn: vi.fn(async () => ({ repoId: null, memoryFiles: [] })),
    bootstrapSessionMemory: vi.fn(async () => undefined),
  }));

  const upsertEdge = vi.fn(async (input: Record<string, unknown>) => ({
    edge: {
      ...input,
      created_at: new Date().toISOString(),
    },
    created: true,
  }));
  vi.doMock('../src/db/sessionGraph.js', () => ({
    sessionGraph: {
      setRole: vi.fn(async (id: string, role: Session['role']) => session({ id, role })),
      upsert: upsertEdge,
    },
  }));

  const { registerLaunchRoutes } = await import('../src/routes/launch.js');
  const { pubsub } = await import('../src/services/pubsub.js');
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => {
    request.user = user(role);
  });
  registerLaunchRoutes(app);

  const agentSend = vi.fn();
  if (options.agentConnected ?? true) {
    const socket = { send: agentSend };
    pubsub.addAgentConnection(hostId, socket as never);
    pubsub.markAgentReady(hostId, socket as never);
  } else {
    pubsub.removeAgentConnection(hostId);
  }

  return { app, agentSend, upsertEdge };
}

describe('launch routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns launch targets with host aliases, provider support, projects, and tmux recents', async () => {
    const { app } = await buildServer('viewer');

    const response = await app.inject({ method: 'GET', url: '/v1/launch/targets' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      targets: [
        {
          host_id: hostId,
          alias: 'heavisidelinux',
          online: true,
          supports_terminal: true,
          supports_spawn: true,
          supports_directory_listing: true,
          providers: { codex: true, claude_code: true },
          roots: ['/home/cvsloane/dev'],
          recent_projects: [{ path: '/home/cvsloane/dev/agent-command' }],
          recent_tmux: [{ tmux_target: 'agents:1.0' }],
          recent_launches: [{ working_directory: '/home/cvsloane/dev/agent-command' }],
        },
      ],
    });
    await app.close();
  });

  it('rejects viewer launch attempts', async () => {
    const { app } = await buildServer('viewer');

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launch',
      payload: {
        host_id: hostId,
        provider: 'codex',
        working_directory: '/home/cvsloane/dev/agent-command',
      },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('queues durable launches while hosts are offline', async () => {
    const { app, agentSend } = await buildServer('operator', {
      host: host({ last_seen_at: '2026-05-19T10:00:00.000Z' }),
      agentConnected: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launch',
      payload: {
        host_alias: 'heavisidelinux',
        provider: 'codex',
        working_directory: '/home/cvsloane/dev/agent-command',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'starting' });
    expect(agentSend).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects unsupported providers and disabled spawning before dispatch', async () => {
    const unsupported = await buildServer('operator', {
      host: host({ capabilities: { ...host().capabilities, providers: { codex: false, claude_code: true } } }),
    });
    const unsupportedResponse = await unsupported.app.inject({
      method: 'POST',
      url: '/v1/launch',
      payload: {
        host_id: hostId,
        provider: 'codex',
        working_directory: '/home/cvsloane/dev/agent-command',
      },
    });
    expect(unsupportedResponse.statusCode).toBe(400);
    expect(unsupported.agentSend).not.toHaveBeenCalled();
    await unsupported.app.close();

    const disabled = await buildServer('operator', {
      host: host({ capabilities: { ...host().capabilities, spawn: false } }),
    });
    const disabledResponse = await disabled.app.inject({
      method: 'POST',
      url: '/v1/launch',
      payload: {
        host_id: hostId,
        provider: 'codex',
        working_directory: '/home/cvsloane/dev/agent-command',
      },
    });
    expect(disabledResponse.statusCode).toBe(403);
    expect(disabled.agentSend).not.toHaveBeenCalled();
    await disabled.app.close();
  });

  it('waits for an openable tmux pane and sends an optional initial prompt', async () => {
    const { app, agentSend } = await buildServer('operator');

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launch',
      payload: {
        host_alias: 'heavisidelinux',
        provider: 'codex',
        working_directory: '/home/cvsloane/dev/agent-command',
        prompt: 'Implement the launch workflow',
        tmux: { target_session: 'agent-command', window_name: 'codex-launch' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      session_id: sessionId,
      status: 'ready',
      href: `/tmux?host_id=${hostId}&session_id=${sessionId}&mode=terminal&attach=1`,
      terminal: { openable: true, pane_id: '%1' },
    });

    const messages = agentSend.mock.calls.map(([raw]) => JSON.parse(String(raw)) as {
      type: string;
      payload: { command: { type: string; payload: Record<string, unknown> } };
    });
    expect(messages.map((message) => message.payload.command.type)).toEqual(
      expect.arrayContaining(['spawn_session', 'send_input'])
    );
    expect(messages.find((message) => message.payload.command.type === 'send_input')?.payload.command.payload).toMatchObject({
      text: 'Implement the launch workflow',
      enter: true,
    });
    await app.close();
  });

  it('passes parent linkage and role through the mobile launch flow', async () => {
    const { app, agentSend, upsertEdge } = await buildServer('operator', {
      sessionSequence: [
        session({ id: parentSessionId, role: 'orchestrator', status: 'RUNNING' }),
        session({ role: 'worker' }),
      ],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launch',
      payload: {
        host_id: hostId,
        provider: 'codex',
        working_directory: '/home/cvsloane/dev/agent-command',
        parent_session_id: parentSessionId,
        role: 'worker',
        wait: false,
      },
    });

    expect(response.statusCode).toBe(200);
    const childSessionId = response.json().session_id;
    expect(upsertEdge).toHaveBeenCalledWith({
      parent_session_id: parentSessionId,
      child_session_id: childSessionId,
      edge_type: 'spawned',
    });
    const spawnMessage = agentSend.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .find((message) => message.payload.command.type === 'spawn_session');
    expect(spawnMessage.payload.command.payload).toMatchObject({
      parent_session_id: parentSessionId,
      role: 'worker',
    });
    await app.close();
  });

  it('returns the original launch for a repeated Idempotency-Key without redispatching', async () => {
    const { app, agentSend } = await buildServer('operator');
    const request = {
      method: 'POST' as const,
      url: '/v1/launch',
      headers: { 'idempotency-key': 'launch-once' },
      payload: {
        host_id: hostId,
        provider: 'codex',
        working_directory: '/home/cvsloane/dev/agent-command',
      },
    };

    const first = await app.inject(request);
    const second = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      session_id: first.json().session_id,
      cmd_id: first.json().cmd_id,
    });
    const spawnMessages = agentSend.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .filter((message) => message.payload?.command?.type === 'spawn_session');
    expect(spawnMessages).toHaveLength(1);
    await app.close();
  });
});
