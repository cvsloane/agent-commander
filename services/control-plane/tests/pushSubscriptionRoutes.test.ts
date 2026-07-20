import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/auth/types.js';

const userId = '11111111-1111-4111-8111-111111111111';
const subscriptionId = '22222222-2222-4222-8222-222222222222';
const endpoint = 'https://push.example.test/subscriptions/123';

async function buildServer(): Promise<{
  app: FastifyInstance;
  upsert: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const upsert = vi.fn(async () => ({
    id: subscriptionId,
    endpoint,
    device_label: 'Chris phone',
    created_at: '2026-07-19T16:00:00.000Z',
    last_seen_at: '2026-07-19T16:00:00.000Z',
  }));
  const remove = vi.fn(async () => true);
  vi.doMock('../src/db/pushSubscriptions.js', () => ({
    pushSubscriptions: {
      upsert,
      remove,
      list: vi.fn(async () => []),
    },
  }));
  vi.doMock('../src/services/webPush.js', () => ({
    webPushService: { publicKey: 'vapid-public-key' },
  }));

  const { registerPushSubscriptionRoutes } = await import('../src/routes/pushSubscriptions.js');
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => {
    request.user = {
      id: userId,
      sub: 'operator@example.test',
      role: 'operator',
      auth_type: 'jwt',
    } satisfies AuthUser;
  });
  registerPushSubscriptionRoutes(app);
  return { app, upsert, remove };
}

describe('push subscription routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('returns the configured VAPID public key', async () => {
    const { app } = await buildServer();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/push/vapid-public-key',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enabled: true, public_key: 'vapid-public-key' });
    await app.close();
  });

  it('upserts a browser subscription for only the authenticated user', async () => {
    const { app, upsert } = await buildServer();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/push-subscriptions',
      payload: {
        endpoint,
        keys: { p256dh: 'public-key', auth: 'auth-secret' },
        device_label: 'Chris phone',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(upsert).toHaveBeenCalledWith(userId, {
      endpoint,
      p256dh: 'public-key',
      auth: 'auth-secret',
      device_label: 'Chris phone',
    });
    expect(response.json()).toMatchObject({ subscription: { id: subscriptionId } });
    await app.close();
  });

  it('accepts the PWA flat payload on the push namespace alias', async () => {
    const { app, upsert } = await buildServer();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/push/subscriptions',
      payload: {
        endpoint,
        p256dh: 'public-key',
        auth: 'auth-secret',
        device_label: 'Chris phone',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ success: true });
    expect(upsert).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        endpoint,
        p256dh: 'public-key',
        auth: 'auth-secret',
      })
    );
    await app.close();
  });

  it('unsubscribes by endpoint without crossing the authenticated user boundary', async () => {
    const { app, remove } = await buildServer();
    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/push-subscriptions',
      payload: { endpoint },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
    expect(remove).toHaveBeenCalledWith(userId, endpoint);
    await app.close();
  });

  it('rejects subscriptions without both browser encryption keys', async () => {
    const { app, upsert } = await buildServer();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/push-subscriptions',
      payload: { endpoint, keys: { p256dh: 'public-key' } },
    });

    expect(response.statusCode).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
    await app.close();
  });
});
