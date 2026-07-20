import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hasRole } from '../auth/rbac.js';
import * as db from '../db/index.js';

const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  action: z.string().trim().min(1).max(120).optional(),
  object_type: z.string().trim().min(1).max(120).optional(),
});

export function registerAuditRoutes(app: FastifyInstance): void {
  app.get('/v1/audit', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'admin')) {
      return reply.status(403).send({ error: 'Admin role required' });
    }
    const query = AuditQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters' });
    }
    const auditLogs = await db.listAuditLogs(query.data);
    return {
      audit_logs: auditLogs,
      pagination: { limit: query.data.limit, offset: query.data.offset },
    };
  });
}
