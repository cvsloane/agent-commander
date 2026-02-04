import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as db from '../db/index.js';
import { hasRole } from '../auth/rbac.js';

const ProjectsQuerySchema = z.object({
  host_id: z.string().uuid().optional(),
  q: z.string().min(1).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
});

export function registerProjectRoutes(app: FastifyInstance): void {
  // GET /v1/projects - list projects for user (optionally filtered by host/q)
  app.get('/v1/projects', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'viewer')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const query = ProjectsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters' });
    }

    const projects = await db.getProjects(request.user.id, {
      host_id: query.data.host_id,
      q: query.data.q,
      limit: query.data.limit,
    });

    return { projects };
  });
}
