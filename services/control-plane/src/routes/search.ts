import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as db from '../db/index.js';

// Query schema
const SearchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  type: z
    .string()
    .transform((v) => v.split(',') as Array<'sessions' | 'events' | 'snapshots'>)
    .optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export function registerSearchRoutes(app: FastifyInstance): void {
  // GET /v1/search - Global search across sessions, events, and snapshots
  app.get<{ Querystring: unknown }>('/v1/search', async (request, reply) => {
    const queryResult = SearchQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({ error: 'Invalid query parameters', details: queryResult.error });
    }

    const { q, type, limit, offset } = queryResult.data;

    // Validate type values if provided
    const validTypes = ['sessions', 'events', 'snapshots'] as const;
    if (type) {
      const invalidTypes = type.filter((t) => !validTypes.includes(t as typeof validTypes[number]));
      if (invalidTypes.length > 0) {
        return reply.status(400).send({
          error: `Invalid search types: ${invalidTypes.join(', ')}. Valid types: ${validTypes.join(', ')}`,
        });
      }
    }

    try {
      const { results, total } = await db.search(q, {
        types: type as Array<'sessions' | 'events' | 'snapshots'>,
        limit,
        offset,
      });

      return {
        query: q,
        results,
        total,
        limit,
        offset,
      };
    } catch (error: unknown) {
      // Handle case where search_vector columns don't exist yet (migration not run)
      if (error instanceof Error && error.message.includes('search_vector')) {
        return reply.status(503).send({
          error: 'Search not available',
          details: 'Full-text search indexes have not been created. Run migration 006_search.sql.',
        });
      }
      throw error;
    }
  });
}
