import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/auth/types.js';

const admin: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  sub: 'admin@example.test',
  role: 'admin',
  auth_type: 'jwt',
};

describe('audit routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('returns recent audit rows to admins with bounded pagination', async () => {
    const listAuditLogs = vi.fn(async () => [{
      id: '1',
      ts: '2026-07-19T20:00:00.000Z',
      user_id: admin.id,
      user_email: 'admin@example.test',
      user_name: 'Admin',
      user_role: 'admin',
      action: 'terminal.detach',
      object_type: 'session',
      object_id: '22222222-2222-4222-8222-222222222222',
      payload: { duration_ms: 1500 },
    }]);
    vi.doMock('../src/db/index.js', () => ({ listAuditLogs }));
    const { registerAuditRoutes } = await import('../src/routes/audit.js');
    const app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      request.user = admin;
    });
    registerAuditRoutes(app);

    const response = await app.inject('/v1/audit?limit=25&offset=10&action=terminal.detach');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      audit_logs: [expect.objectContaining({ action: 'terminal.detach' })],
      pagination: { limit: 25, offset: 10 },
    });
    expect(listAuditLogs).toHaveBeenCalledWith({
      limit: 25,
      offset: 10,
      action: 'terminal.detach',
      object_type: undefined,
    });
    await app.close();
  });

  it('rejects non-admin readers', async () => {
    vi.doMock('../src/db/index.js', () => ({ listAuditLogs: vi.fn() }));
    const { registerAuditRoutes } = await import('../src/routes/audit.js');
    const app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      request.user = { ...admin, role: 'operator' };
    });
    registerAuditRoutes(app);

    expect((await app.inject('/v1/audit')).statusCode).toBe(403);
    await app.close();
  });
});
