import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const taskId = '33333333-3333-4333-8333-333333333333';
const now = '2026-07-19T16:00:00.000Z';

function waitForMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for message')), 1_000);
    socket.once('message', (raw) => {
      clearTimeout(timeout);
      resolve(JSON.parse(String(raw)));
    });
  });
}

function waitForClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once('close', resolve));
}

function hello() {
  return {
    v: 1,
    type: 'agent.hello',
    ts: now,
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

async function buildServer(options: {
  insertedEvent?: Record<string, unknown> | null;
  upsertError?: Error;
} = {}): Promise<{
  app: FastifyInstance;
  url: string;
  upsertAgentTask: ReturnType<typeof vi.fn>;
  publishAgentTasksChanged: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const insertedEvent = options.insertedEvent === undefined
    ? { id: 1, session_id: sessionId, ts: now, type: 'workshop.subagent_start', payload: {} }
    : options.insertedEvent;
  vi.doMock('../src/db/index.js', () => ({
    pool: { query: vi.fn(async () => ({ rows: [] })) },
    validateAgentToken: vi.fn(async () => hostId),
    upsertHost: vi.fn(async () => ({ last_acked_seq: 0 })),
    updateHostLastSeen: vi.fn(async () => undefined),
    updateHostAckedSeq: vi.fn(async () => undefined),
    insertEvent: vi.fn(async () => insertedEvent),
    getSessionById: vi.fn(async (id: string) => ({ id, host_id: hostId })),
  }));

  const upsertAgentTask = vi.fn(async (input: Record<string, unknown>) => {
    if (options.upsertError) throw options.upsertError;
    return {
      id: taskId,
      ...input,
    };
  });
  vi.doMock('../src/db/agentTasks.js', async () => {
    const actual = await vi.importActual<typeof import('../src/db/agentTasks.js')>(
      '../src/db/agentTasks.js'
    );
    return {
      ...actual,
      agentTasks: { upsert: upsertAgentTask },
    };
  });

  const { registerAgentWebSocket } = await import('../src/ws/agent.js');
  const { pubsub } = await import('../src/services/pubsub.js');
  const publishAgentTasksChanged = vi.spyOn(pubsub, 'publishAgentTasksChanged');
  const app = Fastify({ logger: false });
  await app.register(websocket);
  registerAgentWebSocket(app);
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  return {
    app,
    url: address.replace(/^http/, 'ws'),
    upsertAgentTask,
    publishAgentTasksChanged,
  };
}

async function connect(url: string): Promise<WebSocket> {
  const socket = new WebSocket(`${url}/v1/agent/connect`, {
    headers: { Authorization: 'Bearer test-agent-token' },
  });
  await new Promise<void>((resolve) => socket.once('open', resolve));
  socket.send(JSON.stringify(hello()));
  await waitForMessage(socket);
  return socket;
}

describe('agent-task event ingest', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/db/index.js');
    vi.doUnmock('../src/db/agentTasks.js');
  });

  it('persists and publishes a workshop subagent hook before acknowledging it', async () => {
    const { app, url, upsertAgentTask, publishAgentTasksChanged } = await buildServer();
    const socket = await connect(url);
    socket.send(JSON.stringify({
      v: 1,
      type: 'events.append',
      ts: now,
      seq: 2,
      payload: {
        session_id: sessionId,
        event_id: '01J00000000000000000000000',
        event_type: 'workshop.subagent_start',
        payload: {
          tool_use_id: 'toolu_01',
          description: 'Inspect contracts',
          timestamp: Date.parse(now),
        },
      },
    }));

    await expect(waitForMessage(socket)).resolves.toMatchObject({
      type: 'agent.ack',
      payload: { ack_seq: 2, status: 'ok' },
    });
    expect(upsertAgentTask).toHaveBeenCalledWith(expect.objectContaining({
      session_id: sessionId,
      tool_use_id: 'toolu_01',
      status: 'running',
    }));
    expect(publishAgentTasksChanged).toHaveBeenCalledWith(sessionId, [
      expect.objectContaining({ id: taskId, tool_use_id: 'toolu_01' }),
    ]);
    socket.close();
    await app.close();
  });

  it('rebuilds an agent task when the append itself was already deduplicated', async () => {
    const { app, url, upsertAgentTask } = await buildServer({ insertedEvent: null });
    const socket = await connect(url);
    socket.send(JSON.stringify({
      v: 1,
      type: 'events.append',
      ts: now,
      seq: 2,
      payload: {
        session_id: sessionId,
        event_id: '01J00000000000000000000000',
        event_type: 'workshop.post_tool_use',
        payload: {
          tool: 'Task',
          toolUseId: 'toolu_01',
          toolInput: { description: 'Inspect contracts' },
          timestamp: Date.parse(now),
          success: true,
        },
      },
    }));

    await expect(waitForMessage(socket)).resolves.toMatchObject({
      payload: { ack_seq: 2, status: 'ok' },
    });
    expect(upsertAgentTask).toHaveBeenCalledWith(expect.objectContaining({
      tool_use_id: 'toolu_01',
      status: 'completed',
    }));
    socket.close();
    await app.close();
  });

  it('closes without acknowledgement when the derived agent-task write fails', async () => {
    const { app, url, publishAgentTasksChanged } = await buildServer({
      upsertError: new Error('agent_tasks unavailable'),
    });
    const socket = await connect(url);
    const received: Record<string, unknown>[] = [];
    socket.on('message', (raw) => received.push(JSON.parse(String(raw))));
    const closed = waitForClose(socket);
    socket.send(JSON.stringify({
      v: 1,
      type: 'events.append',
      ts: now,
      seq: 2,
      payload: {
        session_id: sessionId,
        event_type: 'workshop.subagent_stop',
        payload: {
          tool_use_id: 'toolu_01',
          timestamp: Date.parse(now),
        },
      },
    }));

    await closed;
    expect(received).toEqual([]);
    expect(publishAgentTasksChanged).not.toHaveBeenCalled();
    await app.close();
  });
});
