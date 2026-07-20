import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const hostCommandSessionId = '00000000-0000-0000-0000-000000000000';

function waitForClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once('close', resolve));
}

function waitForMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for message')), 1_000);
    socket.once('message', (raw) => {
      clearTimeout(timeout);
      resolve(JSON.parse(String(raw)));
    });
  });
}

function waitForMessages(socket: WebSocket, count: number): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const messages: Record<string, unknown>[] = [];
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for messages')), 1_000);
    socket.on('message', (raw) => {
      messages.push(JSON.parse(String(raw)));
      if (messages.length === count) {
        clearTimeout(timeout);
        resolve(messages);
      }
    });
  });
}

async function buildServer(
  insertEvent: ReturnType<typeof vi.fn>,
  deliverable: Record<string, unknown>[] = []
): Promise<{
  app: FastifyInstance;
  url: string;
  upsertSession: ReturnType<typeof vi.fn>;
  upsertEdge: ReturnType<typeof vi.fn>;
  publishSessionEdgesChanged: ReturnType<typeof vi.fn>;
  handleTerminalStatus: ReturnType<typeof vi.fn>;
  createAuditLog: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const upsertSession = vi.fn(async (upsertHostId: string, input: Record<string, unknown>) => ({
    host_id: upsertHostId,
    ...input,
  }));
  const pool = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      if (text.includes('WITH deliverable AS')) {
        const next = deliverable.find((row) => row.status === 'queued');
        if (!next) return { rows: [] };
        next.status = 'sent';
        return { rows: [{ ...next }] };
      }
      if (text.includes('SELECT * FROM commands') && String(values?.[0]).length !== 36) {
        throw Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' });
      }
      if (text.includes('SELECT * FROM commands')) return { rows: deliverable };
      if (text.includes("SET status = 'sent'")) {
        const row = deliverable.find((candidate) => candidate.cmd_id === values?.[0]);
        return { rows: row ? [row] : [] };
      }
      return { rows: [] };
    }),
  };
  const createAuditLog = vi.fn(async () => undefined);
  vi.doMock('../src/db/index.js', () => ({
    pool,
    validateAgentToken: vi.fn(async () => hostId),
    upsertHost: vi.fn(async () => ({ last_acked_seq: 0 })),
    updateHostLastSeen: vi.fn(async () => undefined),
    updateHostAckedSeq: vi.fn(async () => undefined),
    insertEvent,
    createAuditLog,
    upsertSession,
    getSessionById: vi.fn(async (id: string) => id === sessionId ? { id, host_id: hostId } : null),
  }));
  const edgeKeys = new Set<string>();
  const upsertEdge = vi.fn(async (input: Record<string, unknown>) => {
    const key = `${input.parent_session_id}:${input.child_session_id}:${input.edge_type}`;
    const created = !edgeKeys.has(key);
    edgeKeys.add(key);
    return {
      edge: {
        ...input,
        created_at: new Date().toISOString(),
      },
      created,
    };
  });
  vi.doMock('../src/db/sessionGraph.js', () => ({
    sessionGraph: { upsert: upsertEdge },
  }));
  const handleTerminalStatus = vi.fn();
  vi.doMock('../src/routes/terminal.js', () => ({
    handleTerminalOutput: vi.fn(),
    handleTerminalStatus,
  }));

  const { registerAgentWebSocket } = await import('../src/ws/agent.js');
  const { pubsub } = await import('../src/services/pubsub.js');
  const publishSessionEdgesChanged = vi.spyOn(pubsub, 'publishSessionEdgesChanged');
  const app = Fastify({ logger: false });
  await app.register(websocket);
  registerAgentWebSocket(app);
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  return {
    app,
    url: address.replace(/^http/, 'ws'),
    upsertSession,
    upsertEdge,
    publishSessionEdgesChanged,
    handleTerminalStatus,
    createAuditLog,
  };
}

function hello() {
  return {
    v: 1,
    type: 'agent.hello',
    ts: new Date().toISOString(),
    seq: 1,
    payload: {
      host: {
        id: hostId,
        name: 'test-host',
        agent_version: 'test',
        capabilities: {},
      },
    },
  };
}

describe('agent websocket ingest', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/db/index.js');
    vi.doUnmock('../src/routes/terminal.js');
  });

  it('acknowledges terminal lag and surfaces it to the browser channel', async () => {
    const { app, url, handleTerminalStatus } = await buildServer(vi.fn(async () => undefined));
    const socket = new WebSocket(`${url}/v1/agent/connect`, {
      headers: { Authorization: 'Bearer test-agent-token' },
    });
    await new Promise<void>((resolve) => socket.once('open', resolve));
    socket.send(JSON.stringify(hello()));
    await waitForMessage(socket);

    socket.send(JSON.stringify({
      v: 1,
      type: 'terminal.lag',
      ts: new Date().toISOString(),
      seq: 2,
      payload: {
        channel_id: '33333333-3333-4333-8333-333333333333',
        message: 'Dropped 4 terminal output chunks',
        dropped: 4,
      },
    }));

    await expect(waitForMessage(socket)).resolves.toMatchObject({
      type: 'agent.ack',
      payload: { ack_seq: 2, status: 'ok' },
    });
    expect(handleTerminalStatus).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      'lag',
      'Dropped 4 terminal output chunks',
      { dropped: 4 }
    );

    socket.send(JSON.stringify({
      v: 1,
      type: 'terminal.attached',
      ts: new Date().toISOString(),
      seq: 3,
      payload: {
        channel_id: '33333333-3333-4333-8333-333333333333',
        readonly: true,
        resumed: true,
        resume_token: 'viewer-resume-token',
      },
    }));
    await expect(waitForMessage(socket)).resolves.toMatchObject({
      payload: { ack_seq: 3, status: 'ok' },
    });
    expect(handleTerminalStatus).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      'attached',
      undefined,
      { readonly: true, resumed: true, resume_token: 'viewer-resume-token' }
    );

    socket.close();
    await app.close();
  });

  it('durably records terminal audit events without disconnecting agentd', async () => {
    const { app, url, createAuditLog } = await buildServer(vi.fn(async () => undefined));
    const socket = new WebSocket(`${url}/v1/agent/connect`, {
      headers: { Authorization: 'Bearer test-agent-token' },
    });
    await new Promise<void>((resolve) => socket.once('open', resolve));
    socket.send(JSON.stringify(hello()));
    await waitForMessage(socket);

    socket.send(JSON.stringify({
      v: 1,
      type: 'terminal.audit',
      ts: new Date().toISOString(),
      seq: 2,
      payload: {
        event_type: 'terminal.audit',
        action: 'attach',
        channel_id: '33333333-3333-4333-8333-333333333333',
        session_id: sessionId,
        pane_id: '%1',
      },
    }));

    await expect(waitForMessage(socket)).resolves.toMatchObject({
      type: 'agent.ack',
      payload: { ack_seq: 2, status: 'ok' },
    });
    expect(createAuditLog).toHaveBeenCalledWith(
      'terminal.attach',
      'session',
      sessionId,
      {
        host_id: hostId,
        channel_id: '33333333-3333-4333-8333-333333333333',
        pane_id: '%1',
        source: 'agentd',
      }
    );
    expect(socket.readyState).toBe(WebSocket.OPEN);

    socket.close();
    await app.close();
  });

  it('records deleted-session terminal audits without poisoning the agent queue', async () => {
    const { app, url, createAuditLog, handleTerminalStatus } = await buildServer(vi.fn(async () => undefined));
    const socket = new WebSocket(`${url}/v1/agent/connect`, {
      headers: { Authorization: 'Bearer test-agent-token' },
    });
    await new Promise<void>((resolve) => socket.once('open', resolve));
    socket.send(JSON.stringify(hello()));
    await waitForMessage(socket);

    const deletedSessionId = '44444444-4444-4444-8444-444444444444';
    socket.send(JSON.stringify({
      v: 1,
      type: 'terminal.audit',
      ts: new Date().toISOString(),
      seq: 2,
      payload: {
        event_type: 'terminal.audit',
        action: 'detach',
        channel_id: '33333333-3333-4333-8333-333333333333',
        session_id: deletedSessionId,
        pane_id: '%1',
      },
    }));

    await expect(waitForMessage(socket)).resolves.toMatchObject({
      payload: { ack_seq: 2, status: 'ok' },
    });
    expect(createAuditLog).toHaveBeenCalledWith(
      'terminal.detach',
      'host',
      hostId,
      expect.objectContaining({
        host_id: hostId,
        session_id: deletedSessionId,
        unresolved_session: true,
      })
    );

    socket.send(JSON.stringify({
      v: 1,
      type: 'terminal.lag',
      ts: new Date().toISOString(),
      seq: 3,
      payload: {
        channel_id: '33333333-3333-4333-8333-333333333333',
        dropped: 1,
      },
    }));
    await expect(waitForMessage(socket)).resolves.toMatchObject({
      payload: { ack_seq: 3, status: 'ok' },
    });
    expect(handleTerminalStatus).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      'lag',
      undefined,
      { dropped: 1 }
    );
    expect(socket.readyState).toBe(WebSocket.OPEN);

    socket.close();
    await app.close();
  });

  it('closes without acknowledging a failed durable write and stops later messages', async () => {
    const insertEvent = vi.fn(async () => {
      throw new Error('database unavailable');
    });
    const { app, url, upsertSession } = await buildServer(insertEvent);
    const socket = new WebSocket(`${url}/v1/agent/connect`, {
      headers: { Authorization: 'Bearer test-agent-token' },
    });
    await new Promise<void>((resolve) => socket.once('open', resolve));

    socket.send(JSON.stringify(hello()));
    const helloAck = await waitForMessage(socket);
    expect(helloAck).toMatchObject({
      type: 'agent.ack',
      payload: { ack_seq: 1, status: 'ok' },
    });

    const receivedAfterHello: Record<string, unknown>[] = [];
    socket.on('message', (raw) => receivedAfterHello.push(JSON.parse(String(raw))));
    const closed = waitForClose(socket);
    socket.send(JSON.stringify({
      v: 1,
      type: 'events.append',
      ts: new Date().toISOString(),
      seq: 2,
      payload: {
        session_id: sessionId,
        event_id: '01J00000000000000000000000',
        event_type: 'turn.completed',
        payload: {},
      },
    }));
    socket.send(JSON.stringify({
      v: 1,
      type: 'sessions.upsert',
      ts: new Date().toISOString(),
      seq: 3,
      payload: { sessions: [] },
    }));

    await closed;
    expect(receivedAfterHello).toEqual([]);
    expect(insertEvent).toHaveBeenCalledOnce();
    expect(upsertSession).not.toHaveBeenCalled();
    await app.close();
  });

  it('delivers queued commands after initial inventory and before its acknowledgement', async () => {
    const queued = {
      cmd_id: '55555555-5555-4555-8555-555555555555',
      host_id: hostId,
      session_id: sessionId,
      type: 'commands.dispatch',
      payload: {
        v: 1,
        type: 'commands.dispatch',
        ts: new Date().toISOString(),
        payload: {
          cmd_id: '55555555-5555-4555-8555-555555555555',
          session_id: sessionId,
          command: { type: 'kill_session', payload: {} },
        },
      },
      class: 'durable',
      status: 'queued',
    };
    const { app, url } = await buildServer(vi.fn(async () => undefined), [queued]);
    const socket = new WebSocket(`${url}/v1/agent/connect`, {
      headers: { Authorization: 'Bearer test-agent-token' },
    });
    await new Promise<void>((resolve) => socket.once('open', resolve));

    socket.send(JSON.stringify(hello()));
    const helloAck = await waitForMessage(socket);

    const messages = waitForMessages(socket, 2);
    socket.send(JSON.stringify({
      v: 1,
      type: 'sessions.upsert',
      ts: new Date().toISOString(),
      seq: 2,
      payload: { sessions: [] },
    }));
    const [delivered, inventoryAck] = await messages;

    expect(helloAck).toMatchObject({ type: 'agent.ack', payload: { ack_seq: 1 } });
    expect(delivered).toMatchObject({
      type: 'commands.dispatch',
      payload: { command: { type: 'kill_session' } },
    });
    expect(inventoryAck).toMatchObject({ type: 'agent.ack', payload: { ack_seq: 2 } });
    socket.close();
    await app.close();
  });

  it('acknowledges legacy ULID command results without querying the UUID outbox key', async () => {
    const { app, url } = await buildServer(vi.fn(async () => undefined));
    const socket = new WebSocket(`${url}/v1/agent/connect`, {
      headers: { Authorization: 'Bearer test-agent-token' },
    });
    await new Promise<void>((resolve) => socket.once('open', resolve));

    socket.send(JSON.stringify(hello()));
    await waitForMessage(socket);
    socket.send(JSON.stringify({
      v: 1,
      type: 'sessions.upsert',
      ts: new Date().toISOString(),
      seq: 2,
      payload: { sessions: [] },
    }));
    await waitForMessage(socket);
    socket.send(JSON.stringify({
      v: 1,
      type: 'commands.result',
      ts: new Date().toISOString(),
      seq: 3,
      payload: {
        cmd_id: '01J00000000000000000000000',
        session_id: hostCommandSessionId,
        ok: true,
        result: {},
      },
    }));

    await expect(waitForMessage(socket)).resolves.toMatchObject({
      type: 'agent.ack',
      payload: { ack_seq: 3, status: 'ok' },
    });
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
    await app.close();
  });

  it('persists and publishes forked and parent-stamped edges from session inventory', async () => {
    const {
      app,
      url,
      upsertEdge,
      publishSessionEdgesChanged,
    } = await buildServer(vi.fn(async () => undefined));
    const socket = new WebSocket(`${url}/v1/agent/connect`, {
      headers: { Authorization: 'Bearer test-agent-token' },
    });
    await new Promise<void>((resolve) => socket.once('open', resolve));
    socket.send(JSON.stringify(hello()));
    await waitForMessage(socket);

    const forkParentId = '66666666-6666-4666-8666-666666666666';
    const spawnParentId = '77777777-7777-4777-8777-777777777777';
    const spawnedChildId = '88888888-8888-4888-8888-888888888888';
    socket.send(JSON.stringify({
      v: 1,
      type: 'sessions.upsert',
      ts: new Date().toISOString(),
      seq: 2,
      payload: {
        sessions: [
          {
            id: sessionId,
            kind: 'tmux_pane',
            provider: 'codex',
            status: 'RUNNING',
            forked_from: forkParentId,
          },
          {
            id: spawnedChildId,
            kind: 'tmux_pane',
            provider: 'claude_code',
            status: 'RUNNING',
            metadata: { parent_session_id: spawnParentId },
          },
        ],
      },
    }));

    await expect(waitForMessage(socket)).resolves.toMatchObject({
      payload: { ack_seq: 2, status: 'ok' },
    });
    expect(upsertEdge).toHaveBeenCalledWith({
      parent_session_id: forkParentId,
      child_session_id: sessionId,
      edge_type: 'forked',
    });
    expect(upsertEdge).toHaveBeenCalledWith({
      parent_session_id: spawnParentId,
      child_session_id: spawnedChildId,
      edge_type: 'spawned',
    });
    expect(publishSessionEdgesChanged).toHaveBeenCalledWith(
      forkParentId,
      [expect.objectContaining({ child_session_id: sessionId, edge_type: 'forked' })]
    );
    expect(publishSessionEdgesChanged).toHaveBeenCalledWith(
      spawnParentId,
      [expect.objectContaining({ child_session_id: spawnedChildId, edge_type: 'spawned' })]
    );

    socket.send(JSON.stringify({
      v: 1,
      type: 'sessions.upsert',
      ts: new Date().toISOString(),
      seq: 3,
      payload: {
        sessions: [
          {
            id: sessionId,
            kind: 'tmux_pane',
            provider: 'codex',
            status: 'RUNNING',
            forked_from: forkParentId,
          },
          {
            id: spawnedChildId,
            kind: 'tmux_pane',
            provider: 'claude_code',
            status: 'RUNNING',
            metadata: { parent_session_id: spawnParentId },
          },
        ],
      },
    }));
    await expect(waitForMessage(socket)).resolves.toMatchObject({
      payload: { ack_seq: 3, status: 'ok' },
    });
    expect(upsertEdge).toHaveBeenCalledTimes(4);
    expect(publishSessionEdgesChanged).toHaveBeenCalledTimes(2);
    socket.close();
    await app.close();
  });
});
