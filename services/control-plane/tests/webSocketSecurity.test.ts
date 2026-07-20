import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/auth/types.js';

const jwtSecret = 'test-secret-long-enough-for-websocket-security';
const user: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  sub: 'owner@example.test',
  email: 'owner@example.test',
  role: 'admin',
  auth_type: 'jwt',
};

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

describe('WebSocket ticket authentication', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgres://agent-command:test@localhost:5432/agent_command_test');
    vi.stubEnv('JWT_SECRET', jwtSecret);
    vi.stubEnv('APP_BASE_URL', 'https://commander.example.test');
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('mints a ticket for a JWT-authenticated request and redeems it only once', async () => {
    const { verifyTokenString } = await import('../src/auth/verify.js');
    const { registerAuthRoutes } = await import('../src/routes/auth.js');
    const { webSocketTickets } = await import('../src/security/webSocketAuth.js');
    webSocketTickets.clear();
    const token = await new SignJWT({ role: 'admin', email: user.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.sub)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(jwtSecret));
    const app = Fastify({ logger: false });
    app.addHook('onRequest', async (request, reply) => {
      const bearer = request.headers.authorization?.slice('Bearer '.length) || '';
      const verified = await verifyTokenString(bearer);
      if (!verified) return reply.status(401).send({ error: 'Unauthorized' });
      request.user = verified;
    });
    registerAuthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/ws-ticket',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ ticket: string; expires_at: string }>();
    expect(body.ticket).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(webSocketTickets.redeem(body.ticket)).toMatchObject({ sub: user.sub, role: 'admin' });
    expect(webSocketTickets.redeem(body.ticket)).toBeNull();

    await app.close();
  });

  it('rejects expired tickets', async () => {
    let now = 1_000;
    const { WebSocketTicketStore } = await import('../src/security/webSocketAuth.js');
    const tickets = new WebSocketTicketStore({ ttlSeconds: 1, now: () => now });
    const minted = tickets.mint(user);
    now += 1_001;

    expect(tickets.redeem(minted.ticket)).toBeNull();
  });

  it('rejects browser WebSocket upgrades from an untrusted Origin', async () => {
    const { registerUIWebSocket } = await import('../src/ws/ui.js');
    const app = Fastify({ logger: false });
    await app.register(websocket);
    registerUIWebSocket(app);
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const socket = new WebSocket(`${address.replace(/^http/, 'ws')}/v1/ui/stream?ticket=unused`, {
      headers: {
        Origin: 'https://evil.example.test',
        'X-Forwarded-Host': 'evil.example.test',
        'X-Forwarded-Proto': 'https',
      },
    });

    await expect(waitForClose(socket)).resolves.toEqual({
      code: 4403,
      reason: 'WebSocket origin not allowed',
    });

    await app.close();
  });

  it('accepts a one-time ticket from the request host Origin', async () => {
    const { registerUIWebSocket } = await import('../src/ws/ui.js');
    const { webSocketTickets } = await import('../src/security/webSocketAuth.js');
    webSocketTickets.clear();
    const minted = webSocketTickets.mint(user);
    const app = Fastify({ logger: false });
    await app.register(websocket);
    registerUIWebSocket(app);
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const socket = new WebSocket(
      `${address.replace(/^http/, 'ws')}/v1/ui/stream?ticket=${minted.ticket}`,
      { headers: { Origin: address } }
    );

    await expect(waitForOpen(socket)).resolves.toBeUndefined();
    socket.close();
    await app.close();
  });
});
