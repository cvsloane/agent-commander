import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const subscriptionId = '33333333-3333-4333-8333-333333333333';
const now = '2026-07-19T16:00:00.000Z';

function waitForMessages(socket: WebSocket, count: number): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const messages: Record<string, unknown>[] = [];
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for UI messages')), 1_000);
    const listener = (raw: WebSocket.RawData) => {
      messages.push(JSON.parse(String(raw)));
      if (messages.length === count) {
        clearTimeout(timeout);
        socket.off('message', listener);
        resolve(messages);
      }
    };
    socket.on('message', listener);
  });
}

describe('UI WebSocket resume', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('replays after since and emits initial state only on the first subscribe', async () => {
    const replay = vi.fn(async () => [
      {
        v: 1,
        type: 'events.appended',
        ts: now,
        seq: 42,
        payload: {
          session_id: sessionId,
          event: { id: 42, ts: now, type: 'turn.completed', payload: {} },
        },
      },
    ]);
    const initialSnapshot = vi.fn(async () => [
      {
        v: 1,
        type: 'sessions.changed',
        ts: now,
        payload: { sessions: [] },
      },
    ]);
    vi.doMock('../src/services/uiStreamResume.js', () => ({
      uiStreamResume: { replay, initialSnapshot },
    }));
    vi.doMock('../src/auth/verify.js', () => ({
      verifyTokenString: vi.fn(async () => ({
        id: userId,
        sub: 'operator@example.test',
        role: 'operator',
        auth_type: 'jwt',
      })),
    }));

    const { registerUIWebSocket } = await import('../src/ws/ui.js');
    const app = Fastify({ logger: false });
    await app.register(websocket);
    registerUIWebSocket(app);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const socket = new WebSocket(`${address.replace(/^http/, 'ws')}/v1/ui/stream?token=test`, {
      headers: { Origin: address },
    });
    await new Promise<void>((resolve) => socket.once('open', resolve));

    const firstMessages = waitForMessages(socket, 3);
    socket.send(
      JSON.stringify({
        v: 1,
        type: 'ui.subscribe',
        ts: now,
        payload: {
          subscription_id: subscriptionId,
          since: 41,
          topics: [{ type: 'events' }, { type: 'sessions' }],
        },
      })
    );
    const first = await firstMessages;
    expect(first.map((message) => message.type)).toEqual([
      'events.appended',
      'sessions.changed',
      'ui.subscribed',
    ]);
    expect(first[2]).toMatchObject({
      payload: { subscription_id: subscriptionId },
    });

    const keepaliveMessages = waitForMessages(socket, 2);
    socket.send(
      JSON.stringify({
        v: 1,
        type: 'ui.subscribe',
        ts: now,
        payload: {
          subscription_id: subscriptionId,
          since: 41,
          topics: [{ type: 'events' }, { type: 'sessions' }],
        },
      })
    );
    const keepalive = await keepaliveMessages;
    expect(keepalive.map((message) => message.type)).toEqual([
      'events.appended',
      'ui.subscribed',
    ]);
    expect(keepalive[1]).toMatchObject({
      payload: { subscription_id: subscriptionId },
    });
    expect(replay).toHaveBeenCalledTimes(2);
    expect(replay).toHaveBeenCalledWith(userId, expect.any(Array), 41);
    expect(initialSnapshot).toHaveBeenCalledOnce();

    socket.close();
    await app.close();
  });
});
