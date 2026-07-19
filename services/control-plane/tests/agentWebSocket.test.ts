import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hostId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';

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

async function buildServer(insertEvent: ReturnType<typeof vi.fn>): Promise<{
  app: FastifyInstance;
  url: string;
  upsertSession: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const upsertSession = vi.fn(async () => ({ id: sessionId }));
  vi.doMock('../src/db/index.js', () => ({
    validateAgentToken: vi.fn(async () => hostId),
    upsertHost: vi.fn(async () => ({ last_acked_seq: 0 })),
    updateHostLastSeen: vi.fn(async () => undefined),
    updateHostAckedSeq: vi.fn(async () => undefined),
    insertEvent,
    upsertSession,
  }));

  const { registerAgentWebSocket } = await import('../src/ws/agent.js');
  const app = Fastify({ logger: false });
  await app.register(websocket);
  registerAgentWebSocket(app);
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, url: address.replace(/^http/, 'ws'), upsertSession };
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
    socket.send(
      JSON.stringify({
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
      })
    );
    socket.send(
      JSON.stringify({
        v: 1,
        type: 'sessions.upsert',
        ts: new Date().toISOString(),
        seq: 3,
        payload: { sessions: [] },
      })
    );

    await closed;
    expect(receivedAfterHello).toEqual([]);
    expect(insertEvent).toHaveBeenCalledOnce();
    expect(upsertSession).not.toHaveBeenCalled();
    await app.close();
  });
});
