import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerHttpSecurity } from '../src/security/httpSecurity.js';

describe('control-plane HTTP security', () => {
  it('rate-limits API requests globally while exempting health checks', async () => {
    const app = Fastify({ logger: false });
    await registerHttpSecurity(app, {
      appBaseUrl: 'https://commander.example.test',
      rateLimitMax: 2,
      rateLimitTimeWindowMs: 60_000,
    });
    app.get('/limited', async () => ({ ok: true }));
    app.get('/health', async () => ({ ok: true }));

    expect((await app.inject('/limited')).statusCode).toBe(200);
    expect((await app.inject('/limited')).statusCode).toBe(200);
    expect((await app.inject('/limited')).statusCode).toBe(429);
    expect((await app.inject({
      url: '/limited',
      headers: { upgrade: 'websocket' },
    })).statusCode).toBe(429);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await app.inject('/health')).statusCode).toBe(200);
    }

    await app.close();
  });

  it('emits CORS headers only for the configured application origin', async () => {
    const app = Fastify({ logger: false });
    await registerHttpSecurity(app, {
      appBaseUrl: 'https://commander.example.test/path',
      rateLimitMax: 100,
      rateLimitTimeWindowMs: 60_000,
    });
    app.get('/resource', async () => ({ ok: true }));

    const allowed = await app.inject({
      method: 'GET',
      url: '/resource',
      headers: { origin: 'https://commander.example.test' },
    });
    const denied = await app.inject({
      method: 'GET',
      url: '/resource',
      headers: { origin: 'https://evil.example.test' },
    });

    expect(allowed.headers['access-control-allow-origin']).toBe('https://commander.example.test');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();

    await app.close();
  });
});
