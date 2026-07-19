import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { SignJWT } from 'jose';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Host, Session } from '@agent-command/schema';

const jwtSecret = 'test-secret-long-enough-for-jwt';
const sessionId = '11111111-1111-4111-8111-111111111111';
const hostId = '22222222-2222-4222-8222-222222222222';

async function sign(role: 'admin' | 'operator' | 'viewer'): Promise<string> {
  return new SignJWT({
    sub: `${role}@example.test`,
    email: `${role}@example.test`,
    role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(jwtSecret));
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: sessionId,
    host_id: hostId,
    user_id: null,
    repo_id: null,
    kind: 'tmux_pane',
    provider: 'codex',
    status: 'RUNNING',
    title: 'Terminal route test',
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

function host(terminal = true): Host {
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
      terminal,
      claude_hooks: true,
      codex_exec_json: true,
      list_directory: true,
      list_directory_roots: ['/home/cvsloane/dev'],
      list_directory_show_hidden: false,
      providers: { codex: true },
    },
    agent_version: 'test',
    last_seen_at: '2026-05-19T18:00:00.000Z',
    last_acked_seq: 10,
    created_at: '2026-05-19T17:00:00.000Z',
    updated_at: '2026-05-19T18:00:00.000Z',
  };
}

async function waitForSocketClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once('close', (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
}

async function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

async function eventually(assertion: () => void): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < 1000) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

async function buildServer(options: {
  hostTerminal?: boolean;
  agentConnected?: boolean;
} = {}): Promise<{
  app: FastifyInstance;
  baseWsUrl: string;
  agentSend: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  vi.stubEnv('JWT_SECRET', jwtSecret);
  vi.stubEnv('DATABASE_URL', 'postgres://agent-command:test@localhost:5432/agent_command_test');

  vi.doMock('../src/db/index.js', () => ({
    getSessionById: vi.fn(async () => session()),
    getHostById: vi.fn(async () => host(options.hostTerminal ?? true)),
  }));

  const { registerTerminalRoutes } = await import('../src/routes/terminal.js');
  const { pubsub } = await import('../src/services/pubsub.js');
  const app = Fastify({ logger: false });
  await app.register(websocket);
  registerTerminalRoutes(app);

  const agentSend = vi.fn();
  if (options.agentConnected ?? true) {
    const socket = { send: agentSend };
    pubsub.addAgentConnection(hostId, socket as never);
    pubsub.markAgentReady(hostId, socket as never);
  }

  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  return {
    app,
    baseWsUrl: address.replace(/^http/, 'ws'),
    agentSend,
  };
}

describe('terminal websocket route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects viewers before sending terminal.attach', async () => {
    const { app, baseWsUrl, agentSend } = await buildServer();
    const token = await sign('viewer');
    const socket = new WebSocket(`${baseWsUrl}/v1/ui/terminal/${sessionId}?token=${token}`);

    await expect(waitForSocketClose(socket)).resolves.toMatchObject({
      code: 4008,
      reason: 'Terminal access requires operator role',
    });
    expect(agentSend).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects hosts without terminal capability before attach', async () => {
    const { app, baseWsUrl, agentSend } = await buildServer({ hostTerminal: false });
    const token = await sign('operator');
    const socket = new WebSocket(`${baseWsUrl}/v1/ui/terminal/${sessionId}?token=${token}`);

    await expect(waitForSocketClose(socket)).resolves.toMatchObject({
      code: 4009,
      reason: 'Host does not support terminal sessions',
    });
    expect(agentSend).not.toHaveBeenCalled();
    await app.close();
  });

  it('attaches operator terminals and forwards resize, input, control, and detach', async () => {
    const { app, baseWsUrl, agentSend } = await buildServer();
    const token = await sign('operator');
    const socket = new WebSocket(`${baseWsUrl}/v1/ui/terminal/${sessionId}?token=${token}`);

    await waitForOpen(socket);
    await eventually(() => {
      expect(agentSend).toHaveBeenCalledWith(expect.stringContaining('terminal.attach'));
    });

    socket.send(JSON.stringify({ type: 'resize', cols: 120, rows: 32 }));
    socket.send(JSON.stringify({ type: 'input', data: 'ls\n' }));
    socket.send(JSON.stringify({ type: 'control' }));
    socket.send(JSON.stringify({ type: 'detach' }));

    await eventually(() => {
      const messages = agentSend.mock.calls.map(([raw]) => JSON.parse(String(raw)) as { type: string; payload: Record<string, unknown> });
      expect(messages.map((message) => message.type)).toEqual(expect.arrayContaining([
        'terminal.attach',
        'terminal.resize',
        'terminal.input',
        'terminal.control',
        'terminal.detach',
      ]));
      expect(messages.find((message) => message.type === 'terminal.input')?.payload.data).toBe('ls\n');
      expect(messages.find((message) => message.type === 'terminal.resize')?.payload).toMatchObject({ cols: 120, rows: 32 });
    });

    socket.close();
    await app.close();
  });

  it('allows multiple browser viewers for the same session without evicting the first viewer', async () => {
    const { app, baseWsUrl, agentSend } = await buildServer();
    const token = await sign('operator');
    const first = new WebSocket(`${baseWsUrl}/v1/ui/terminal/${sessionId}?token=${token}`);
    const second = new WebSocket(`${baseWsUrl}/v1/ui/terminal/${sessionId}?token=${token}`);

    await Promise.all([waitForOpen(first), waitForOpen(second)]);

    await eventually(() => {
      const messages = agentSend.mock.calls.map(([raw]) => JSON.parse(String(raw)) as { type: string });
      expect(messages.filter((message) => message.type === 'terminal.attach')).toHaveLength(2);
    });
    expect(first.readyState).toBe(WebSocket.OPEN);
    expect(second.readyState).toBe(WebSocket.OPEN);

    first.close();
    second.close();
    await app.close();
  });
});
