import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type { AuthUser } from '../auth/types.js';
import { verifyTokenString } from '../auth/verify.js';
import { config } from '../config.js';

interface WebSocketTicketRecord {
  user: AuthUser;
  expiresAt: number;
}

interface WebSocketTicketStoreOptions {
  ttlSeconds: number;
  now?: () => number;
}

export class WebSocketTicketStore {
  private readonly tickets = new Map<string, WebSocketTicketRecord>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: WebSocketTicketStoreOptions) {
    this.ttlMs = options.ttlSeconds * 1000;
    this.now = options.now || Date.now;
  }

  mint(user: AuthUser): { ticket: string; expires_at: string } {
    this.pruneExpired();
    const ticket = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + this.ttlMs;
    this.tickets.set(ticket, { user: { ...user }, expiresAt });
    return { ticket, expires_at: new Date(expiresAt).toISOString() };
  }

  redeem(ticket: string): AuthUser | null {
    const record = this.tickets.get(ticket);
    if (!record) return null;
    this.tickets.delete(ticket);
    if (record.expiresAt <= this.now()) return null;
    return { ...record.user };
  }

  clear(): void {
    this.tickets.clear();
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [ticket, record] of this.tickets) {
      if (record.expiresAt <= now) this.tickets.delete(ticket);
    }
  }
}

export const webSocketTickets = new WebSocketTicketStore({
  ttlSeconds: config.WS_TICKET_TTL_SECONDS,
});

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(',', 1)[0]?.trim() || undefined;
}

function configuredOrigins(): Set<string> {
  const values = [
    config.APP_BASE_URL,
    ...(config.WS_ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean),
  ];
  const origins = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Config validation covers APP_BASE_URL; ignore malformed optional allowlist entries.
    }
  }
  return origins;
}

function requestOrigin(request: FastifyRequest): string | null {
  const host = firstHeaderValue(request.headers.host);
  if (!host) return null;
  try {
    return new URL(`${request.protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

export function isWebSocketOriginAllowed(request: FastifyRequest): boolean {
  const originHeader = request.headers.origin;
  const rawOrigin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (
    !rawOrigin
    || (Array.isArray(originHeader) && originHeader.length !== 1)
    || rawOrigin.includes(',')
  ) {
    return false;
  }
  let origin: string;
  try {
    origin = new URL(rawOrigin).origin;
  } catch {
    return false;
  }
  return origin === requestOrigin(request) || configuredOrigins().has(origin);
}

function rejectOrigin(app: FastifyInstance, socket: WebSocket, request: FastifyRequest): false {
  app.log.warn(
    { origin: request.headers.origin, path: request.url },
    'Rejected WebSocket upgrade from untrusted origin'
  );
  socket.close(4403, 'WebSocket origin not allowed');
  return false;
}

export function enforceAgentWebSocketOrigin(
  app: FastifyInstance,
  socket: WebSocket,
  request: FastifyRequest
): boolean {
  if (isWebSocketOriginAllowed(request)) return true;
  const hasOrigin = Boolean(firstHeaderValue(request.headers.origin));
  const hasBearer = request.headers.authorization?.startsWith('Bearer ') === true;
  if (!hasOrigin && hasBearer) return true;
  return rejectOrigin(app, socket, request);
}

export async function authenticateBrowserWebSocket(
  app: FastifyInstance,
  socket: WebSocket,
  request: FastifyRequest
): Promise<AuthUser | null> {
  if (!isWebSocketOriginAllowed(request)) {
    rejectOrigin(app, socket, request);
    return null;
  }

  const url = new URL(request.url, 'http://localhost');
  const ticket = url.searchParams.get('ticket');
  if (ticket) {
    const user = webSocketTickets.redeem(ticket);
    if (!user) socket.close(4003, 'Invalid or expired WebSocket ticket');
    return user;
  }

  const token = url.searchParams.get('token');
  if (!token) {
    socket.close(4002, 'Missing WebSocket ticket');
    return null;
  }
  app.log.warn(
    { path: request.url.split('?', 1)[0] },
    'Deprecated WebSocket ?token= authentication used; migrate to one-time tickets'
  );
  const user = await verifyTokenString(token);
  if (!user) socket.close(4003, 'Invalid auth token');
  return user;
}
