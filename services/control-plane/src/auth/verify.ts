import { jwtVerify } from 'jose';
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';
import type { AuthUser } from './types.js';

const USER_ID_NAMESPACE = '6e2b1c4a-0d0c-4f6c-9c37-5d1f6d2b3f28';

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) {
    throw new Error('Invalid UUID');
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function uuidv5(name: string, namespace: string): string {
  const nsBytes = uuidToBytes(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const toHash = new Uint8Array(nsBytes.length + nameBytes.length);
  toHash.set(nsBytes);
  toHash.set(nameBytes, nsBytes.length);
  const hash = createHash('sha1').update(toHash).digest();
  const bytes = Uint8Array.from(hash.slice(0, 16));
  const b6 = bytes[6] ?? 0;
  const b8 = bytes[8] ?? 0;
  bytes[6] = (b6 & 0x0f) | 0x50;
  bytes[8] = (b8 & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

function buildUserId(subject: string, issuer?: string | null): string {
  const name = issuer ? `${issuer}:${subject}` : subject;
  return uuidv5(name, USER_ID_NAMESPACE);
}

function getTokenFromRequest(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (!authHeader) return null;
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

export async function verifyTokenString(token: string): Promise<AuthUser | null> {
  try {
    const secret = new TextEncoder().encode(config.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    if (!payload.sub || typeof payload.sub !== 'string') return null;

    const role = (payload.role as AuthUser['role']) || 'viewer';
    const id = buildUserId(payload.sub, typeof payload.iss === 'string' ? payload.iss : null);

    return {
      id,
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      role,
    };
  } catch {
    return null;
  }
}

export async function verifyRequestToken(request: FastifyRequest): Promise<AuthUser | null> {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  return verifyTokenString(token);
}
