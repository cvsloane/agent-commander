import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasRole } from '../src/auth/rbac.js';
import type { AuthUser } from '../src/auth/types.js';

const jwtSecret = 'test-secret-long-enough-for-jwt';

function user(role: AuthUser['role']): AuthUser {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    sub: `${role}@example.test`,
    role,
    auth_type: 'jwt',
  };
}

async function sign(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(payload.sub))
    .sign(new TextEncoder().encode(jwtSecret));
}

describe('role checks', () => {
  it('allows higher roles to satisfy lower role requirements', () => {
    expect(hasRole(user('admin'), 'operator')).toBe(true);
    expect(hasRole(user('operator'), 'viewer')).toBe(true);
    expect(hasRole(user('viewer'), 'operator')).toBe(false);
  });
});

describe('token verification', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', 'postgres://agent-command:test@localhost:5432/agent_command_test');
    vi.stubEnv('JWT_SECRET', jwtSecret);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('turns a valid JWT into a stable auth user', async () => {
    const { verifyTokenString } = await import('../src/auth/verify.js');
    const token = await sign({
      sub: 'operator@example.test',
      email: 'operator@example.test',
      name: 'Operator',
      role: 'operator',
    });

    const verified = await verifyTokenString(token);

    expect(verified).toMatchObject({
      sub: 'operator@example.test',
      email: 'operator@example.test',
      name: 'Operator',
      role: 'operator',
      auth_type: 'jwt',
    });
    expect(verified?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects invalid JWTs without throwing', async () => {
    const { verifyTokenString } = await import('../src/auth/verify.js');

    await expect(verifyTokenString('not-a-token')).resolves.toBeNull();
  });

  it('accepts configured service tokens before bearer tokens', async () => {
    vi.stubEnv(
      'INTEGRATION_SERVICE_TOKENS_JSON',
      JSON.stringify({
        hermes: {
          token: 'service-token',
          role: 'operator',
          name: 'Hermes',
          email: 'hermes@example.test',
        },
      })
    );
    const { verifyRequestToken } = await import('../src/auth/verify.js');

    const verified = await verifyRequestToken({
      headers: {
        'x-agent-command-service': 'hermes',
        'x-agent-command-service-key': 'service-token',
        authorization: 'Bearer invalid',
      },
    } as never);

    expect(verified).toMatchObject({
      sub: 'service:hermes',
      role: 'operator',
      auth_type: 'service',
      service_name: 'hermes',
    });
  });

  it('rejects service token length mismatches before timing-safe comparison', async () => {
    vi.stubEnv(
      'INTEGRATION_SERVICE_TOKENS_JSON',
      JSON.stringify({
        hermes: { token: 'service-token', role: 'operator' },
      })
    );
    const { verifyRequestToken } = await import('../src/auth/verify.js');

    const verified = await verifyRequestToken({
      headers: {
        'x-agent-command-service': 'hermes',
        'x-agent-command-service-key': 'short',
      },
    } as never);

    expect(verified).toBeNull();
  });

  it('mints a short-lived token scoped to one orchestrator session', async () => {
    const { mintSessionToken, verifyTokenString } = await import('../src/auth/verify.js');
    const sessionId = '22222222-2222-4222-8222-222222222222';
    const userId = '33333333-3333-4333-8333-333333333333';

    const minted = await mintSessionToken({ session_id: sessionId, user_id: userId });
    const verified = await verifyTokenString(minted.token);

    expect(verified).toEqual({
      id: userId,
      sub: `session:${sessionId}`,
      role: 'viewer',
      auth_type: 'session',
      session_id: sessionId,
    });
    expect(new Date(minted.expires_at).getTime()).toBeGreaterThan(Date.now());
  });
});
