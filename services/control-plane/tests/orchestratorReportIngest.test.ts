import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hostId = '11111111-1111-4111-8111-111111111111';
const otherHostId = '44444444-4444-4444-8444-444444444444';
const sessionId = '22222222-2222-4222-8222-222222222222';
const now = '2026-07-19T18:00:00.000Z';

function waitForMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for message')), 1_000);
    socket.once('message', (raw) => {
      clearTimeout(timeout);
      resolve(JSON.parse(String(raw)));
    });
  });
}

async function buildServer(inserted: boolean, sessionHostId = hostId): Promise<{
  app: FastifyInstance;
  url: string;
  reportAutomationRunForSession: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  vi.doMock('../src/db/index.js', () => ({
    pool: { query: vi.fn(async () => ({ rows: [] })) },
    validateAgentToken: vi.fn(async () => hostId),
    upsertHost: vi.fn(async () => ({ last_acked_seq: 0 })),
    updateHostLastSeen: vi.fn(async () => undefined),
    updateHostAckedSeq: vi.fn(async () => undefined),
    insertEvent: vi.fn(async () => inserted ? ({
      id: 1,
      session_id: sessionId,
      ts: now,
      type: 'orchestrator.report',
      payload: {},
    }) : null),
    getSessionById: vi.fn(async (id: string) => ({ id, host_id: sessionHostId })),
  }));
  vi.doMock('../src/db/agentTasks.js', () => ({
    agentTasks: { upsert: vi.fn() },
    agentTaskUpdateFromEvent: vi.fn(() => null),
  }));
  const reportAutomationRunForSession = vi.fn(async () => ({
    run: { id: '33333333-3333-4333-8333-333333333333' },
    replayed: !inserted,
  }));
  vi.doMock('../src/services/automation.js', () => ({ reportAutomationRunForSession }));

  const { registerAgentWebSocket } = await import('../src/ws/agent.js');
  const app = Fastify({ logger: false });
  await app.register(websocket);
  registerAgentWebSocket(app);
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, url: address.replace(/^http/, 'ws'), reportAutomationRunForSession };
}

async function connect(url: string): Promise<WebSocket> {
  const socket = new WebSocket(`${url}/v1/agent/connect`, {
    headers: { Authorization: 'Bearer test-agent-token' },
  });
  await new Promise<void>((resolve) => socket.once('open', resolve));
  socket.send(JSON.stringify({
    v: 1,
    type: 'agent.hello',
    ts: now,
    seq: 1,
    payload: {
      host: { id: hostId, name: 'test-host', agent_version: 'test', capabilities: {} },
    },
  }));
  await waitForMessage(socket);
  return socket;
}

describe('orchestrator.report event ingest', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    vi.doUnmock('../src/db/index.js');
    vi.doUnmock('../src/db/agentTasks.js');
    vi.doUnmock('../src/services/automation.js');
  });

  it.each([true, false])(
    'finalizes the matching run before ack even when event insertion is new=%s',
    async (inserted) => {
      const { app, url, reportAutomationRunForSession } = await buildServer(inserted);
      const socket = await connect(url);
      socket.send(JSON.stringify({
        v: 1,
        type: 'events.append',
        ts: now,
        seq: 2,
        payload: {
          session_id: sessionId,
          event_id: '01J00000000000000000000000',
          event_type: 'orchestrator.report',
          payload: {
            outcome: 'succeeded',
            summary: 'Focused tests pass',
            detail: 'No regressions found',
          },
        },
      }));

      await expect(waitForMessage(socket)).resolves.toMatchObject({
        type: 'agent.ack',
        payload: { ack_seq: 2, status: 'ok' },
      });
      expect(reportAutomationRunForSession).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          outcome: 'succeeded',
          summary: 'Focused tests pass',
          evidence_refs: [],
        })
      );
      socket.close();
      await app.close();
    }
  );

  it('rejects reports for a session owned by a different authenticated host', async () => {
    const { app, url, reportAutomationRunForSession } = await buildServer(true, otherHostId);
    const socket = await connect(url);
    const closed = new Promise<number>((resolve) => socket.once('close', resolve));
    socket.send(JSON.stringify({
      v: 1,
      type: 'events.append',
      ts: now,
      seq: 2,
      payload: {
        session_id: sessionId,
        event_id: '01J00000000000000000000000',
        event_type: 'orchestrator.report',
        payload: {
          outcome: 'succeeded',
          summary: 'Spoofed report',
        },
      },
    }));

    await closed;
    expect(reportAutomationRunForSession).not.toHaveBeenCalled();
    await app.close();
  });
});
