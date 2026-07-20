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

async function waitForMessage(socket: WebSocket): Promise<{ data: WebSocket.RawData; isBinary: boolean }> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data, isBinary) => resolve({ data, isBinary }));
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
  canControlTerminal?: boolean;
  sessionDelayMs?: number;
} = {}): Promise<{
  app: FastifyInstance;
  baseWsUrl: string;
  agentSend: ReturnType<typeof vi.fn>;
  handleTerminalOutput: (channelId: string, data: string, encoding?: 'base64' | 'utf8') => boolean;
  handleTerminalStatus: (
    channelId: string,
    status: string,
    message?: string,
    details?: { readonly?: boolean; resumed?: boolean; resume_token?: string; dropped?: number }
  ) => void;
}> {
  vi.resetModules();
  vi.stubEnv('JWT_SECRET', jwtSecret);
  vi.stubEnv('DATABASE_URL', 'postgres://agent-command:test@localhost:5432/agent_command_test');

  vi.doMock('../src/db/index.js', () => ({
    getSessionById: vi.fn(async () => {
      if (options.sessionDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.sessionDelayMs));
      }
      return session();
    }),
    getHostById: vi.fn(async () => host(options.hostTerminal ?? true)),
  }));
  vi.doMock('../src/services/terminalPolicy.js', () => ({
    canAttachTerminal: (user: { role: string }) => user.role === 'operator' || user.role === 'admin',
    canControlTerminal: () => options.canControlTerminal ?? true,
    hostSupportsTerminal: (candidate: Host | null | undefined) => Boolean(candidate?.capabilities?.terminal),
  }));

  const { registerTerminalRoutes, handleTerminalOutput, handleTerminalStatus } = await import('../src/routes/terminal.js');
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
    handleTerminalOutput,
    handleTerminalStatus: handleTerminalStatus as never,
  };
}

describe('terminal websocket route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('../src/services/terminalPolicy.js');
  });

  it('negotiates compressed binary output while preserving the JSON fallback', async () => {
    const { app, baseWsUrl, agentSend, handleTerminalOutput } = await buildServer();
    const token = await sign('operator');
    const binarySocket = new WebSocket(`${baseWsUrl}/v1/ui/terminal/${sessionId}?token=${token}`);
    const jsonSocket = new WebSocket(`${baseWsUrl}/v1/ui/terminal/${sessionId}?token=${token}`);

    await Promise.all([waitForOpen(binarySocket), waitForOpen(jsonSocket)]);
    expect(binarySocket.extensions).toContain('permessage-deflate');

    await eventually(() => {
      const messages = agentSend.mock.calls.map(([raw]) => JSON.parse(String(raw)) as {
        type: string;
        payload: { channel_id: string };
      });
      expect(messages.filter((message) => message.type === 'terminal.attach')).toHaveLength(2);
    });
    const attaches = agentSend.mock.calls
      .map(([raw]) => JSON.parse(String(raw)) as { type: string; payload: { channel_id: string } })
      .filter((message) => message.type === 'terminal.attach');

    binarySocket.send(JSON.stringify({ type: 'hello', binary: true }));
    binarySocket.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));
    await eventually(() => {
      expect(agentSend.mock.calls.some(([raw]) => JSON.parse(String(raw)).type === 'terminal.resize')).toBe(true);
    });

    const binaryMessage = waitForMessage(binarySocket);
    expect(handleTerminalOutput(attaches[0].payload.channel_id, Buffer.from('hello').toString('base64'), 'base64')).toBe(true);
    await expect(binaryMessage).resolves.toMatchObject({ isBinary: true });
    expect(Buffer.from((await binaryMessage).data).toString()).toBe('hello');

    const jsonMessage = waitForMessage(jsonSocket);
    const encoded = Buffer.from('legacy').toString('base64');
    expect(handleTerminalOutput(attaches[1].payload.channel_id, encoded, 'base64')).toBe(true);
    const fallback = await jsonMessage;
    expect(fallback.isBinary).toBe(false);
    expect(JSON.parse(fallback.data.toString())).toEqual({ type: 'output', data: encoded, encoding: 'base64' });

    binarySocket.close();
    jsonSocket.close();
    await app.close();
  });

  it('buffers hello and resize frames sent while authentication is still initializing', async () => {
    const { app, baseWsUrl, agentSend, handleTerminalOutput } = await buildServer({
      sessionDelayMs: 75,
    });
    const token = await sign('operator');
    const socket = new WebSocket(`${baseWsUrl}/v1/ui/terminal/${sessionId}?token=${token}`);

    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: 'hello', binary: true }));
    socket.send(JSON.stringify({ type: 'resize', cols: 111, rows: 35 }));

    await eventually(() => {
      const messageTypes = agentSend.mock.calls.map(([raw]) => JSON.parse(String(raw)).type);
      expect(messageTypes).toEqual(['terminal.attach', 'terminal.resize']);
    });
    const attach = agentSend.mock.calls
      .map(([raw]) => JSON.parse(String(raw)) as { type: string; payload: { channel_id: string } })
      .find((message) => message.type === 'terminal.attach');
    const output = waitForMessage(socket);
    handleTerminalOutput(String(attach?.payload.channel_id), Buffer.from('buffered').toString('base64'), 'base64');

    await expect(output).resolves.toMatchObject({ isBinary: true });
    socket.close();
    await app.close();
  });

  it('bounds frames buffered while terminal authorization is still initializing', async () => {
    const { app, baseWsUrl, agentSend } = await buildServer({ sessionDelayMs: 75 });
    const token = await sign('operator');
    const socket = new WebSocket(`${baseWsUrl}/v1/ui/terminal/${sessionId}?token=${token}`);

    await waitForOpen(socket);
    const closed = waitForSocketClose(socket);
    socket.send(Buffer.alloc(65 * 1024));

    await expect(closed).resolves.toMatchObject({
      code: 4000,
      reason: 'Too many pending terminal messages',
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(agentSend).not.toHaveBeenCalled();

    await app.close();
  });

  it('forwards initial dimensions and resumes a viewer with the agent-issued token', async () => {
    const { app, baseWsUrl, agentSend, handleTerminalStatus } = await buildServer();
    const token = await sign('operator');
    const resumeToken = 'viewer-resume-token';
    const socket = new WebSocket(
      `${baseWsUrl}/v1/ui/terminal/${sessionId}?token=${token}&cols=132&rows=41&resume_token=${resumeToken}`
    );

    await waitForOpen(socket);
    await eventually(() => {
      expect(agentSend).toHaveBeenCalledWith(expect.stringContaining('terminal.attach'));
    });
    const attach = agentSend.mock.calls
      .map(([raw]) => JSON.parse(String(raw)) as { type: string; payload: Record<string, unknown> })
      .find((message) => message.type === 'terminal.attach');
    expect(attach?.payload).toMatchObject({
      cols: 132,
      rows: 41,
      resume_token: resumeToken,
    });

    const attachedMessage = waitForMessage(socket);
    handleTerminalStatus(String(attach?.payload.channel_id), 'attached', undefined, {
      readonly: true,
      resumed: true,
      resume_token: resumeToken,
    });
    expect(JSON.parse((await attachedMessage).data.toString())).toEqual({
      type: 'attached',
      readonly: true,
      resumed: true,
      resume_token: resumeToken,
    });

    const lagMessage = waitForMessage(socket);
    handleTerminalStatus(String(attach?.payload.channel_id), 'lag', 'Dropped 2 terminal output chunks', {
      dropped: 2,
    });
    expect(JSON.parse((await lagMessage).data.toString())).toEqual({
      type: 'lag',
      message: 'Dropped 2 terminal output chunks',
      dropped: 2,
    });

    socket.close();
    await app.close();
  });

  it('retires a stale browser channel before reattaching its resume token', async () => {
    const { app, baseWsUrl, agentSend, handleTerminalStatus } = await buildServer();
    const token = await sign('operator');
    const first = new WebSocket(`${baseWsUrl}/v1/ui/terminal/${sessionId}?token=${token}`);
    await waitForOpen(first);
    await eventually(() => {
      expect(agentSend).toHaveBeenCalledWith(expect.stringContaining('terminal.attach'));
    });
    const firstAttach = agentSend.mock.calls
      .map(([raw]) => JSON.parse(String(raw)) as { type: string; payload: Record<string, unknown> })
      .find((message) => message.type === 'terminal.attach');
    const resumeToken = 'stale-channel-resume-token';
    const attached = waitForMessage(first);
    handleTerminalStatus(String(firstAttach?.payload.channel_id), 'attached', undefined, {
      resume_token: resumeToken,
    });
    await attached;

    const firstClosed = waitForSocketClose(first);
    const second = new WebSocket(
      `${baseWsUrl}/v1/ui/terminal/${sessionId}?token=${token}&resume_token=${resumeToken}`
    );
    await waitForOpen(second);

    await expect(firstClosed).resolves.toMatchObject({
      code: 4000,
      reason: 'Terminal resumed in another connection',
    });
    await eventually(() => {
      const terminalMessages = agentSend.mock.calls
        .map(([raw]) => JSON.parse(String(raw)) as { type: string; payload: Record<string, unknown> })
        .filter((message) => message.type.startsWith('terminal.'));
      expect(terminalMessages.map((message) => message.type)).toEqual([
        'terminal.attach',
        'terminal.detach',
        'terminal.attach',
      ]);
      expect(terminalMessages[2].payload.resume_token).toBe(resumeToken);
    });

    second.close();
    await app.close();
  });

  it('refuses resize when the authenticated role cannot control the terminal', async () => {
    const { app, baseWsUrl, agentSend } = await buildServer({ canControlTerminal: false });
    const token = await sign('operator');
    const socket = new WebSocket(`${baseWsUrl}/v1/ui/terminal/${sessionId}?token=${token}`);

    await waitForOpen(socket);
    await eventually(() => {
      expect(agentSend).toHaveBeenCalledWith(expect.stringContaining('terminal.attach'));
    });
    const closed = Promise.race([
      waitForSocketClose(socket),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('resize was not rejected')), 500)),
    ]);
    socket.send(JSON.stringify({ type: 'resize', cols: 90, rows: 28 }));

    await expect(closed).resolves.toMatchObject({
      code: 4008,
      reason: 'Terminal resize requires operator role',
    });
    const messageTypes = agentSend.mock.calls.map(([raw]) => JSON.parse(String(raw)).type);
    expect(messageTypes).not.toContain('terminal.resize');

    await app.close();
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
