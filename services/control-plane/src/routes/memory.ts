import type { FastifyInstance } from 'fastify';
import {
  MemorySearchQuerySchema,
  UpsertMemoryEntrySchema,
} from '@agent-command/schema';
import * as memoryDb from '../db/automationMemory.js';
import { recordMemorySearch } from '../metrics.js';
import { hasRole } from '../auth/rbac.js';

export function registerMemoryRoutes(app: FastifyInstance): void {
  app.get('/v1/memory/search', async (request, reply) => {
    const query = MemorySearchQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters', details: query.error });
    }

    const results = await memoryDb.searchMemory(request.user!.id, query.data);
    const scope = query.data.scope_type || (query.data.repo_id ? 'repo+global' : 'all');
    recordMemorySearch(scope, results.length > 0);
    return { results };
  });

  app.post<{ Body: unknown }>('/v1/memory', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'operator')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = UpsertMemoryEntrySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: body.error });
    }

    const entry = await memoryDb.createMemoryEntry(request.user.id, body.data);
    return { entry };
  });
}
