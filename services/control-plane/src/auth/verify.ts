import { jwtVerify } from 'jose';
import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';
import type { AuthUser } from './types.js';

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

    return {
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
