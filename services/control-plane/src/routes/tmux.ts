import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as db from '../db/index.js';

const TmuxRosterQuerySchema = z.object({
  host_id: z.string().uuid().optional(),
});

export function registerTmuxRoutes(app: FastifyInstance): void {
  app.get('/v1/tmux/roster', async (request, reply) => {
    const query = TmuxRosterQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters' });
    }

    const sessions = await db.getTmuxRosterSessions(query.data.host_id);

    return {
      sessions,
      total: sessions.length,
    };
  });
}
