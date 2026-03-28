import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as db from '../db/index.js';
import { hasRole } from '../auth/rbac.js';

const ReposQuerySchema = z.object({
  q: z.string().min(1).optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
});

export function registerRepoRoutes(app: FastifyInstance): void {
  app.get('/v1/repos', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'viewer')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const query = ReposQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters' });
    }

    const repos = await db.listRepos(request.user.id, query.data);
    return { repos };
  });
}
