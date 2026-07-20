import type { FastifyInstance } from 'fastify';
import { UserSettingsSchema } from '@agent-command/schema';
import * as db from '../db/index.js';
import { hasRole } from '../auth/rbac.js';

export function registerSettingsRoutes(app: FastifyInstance): void {
  // GET /v1/settings - Get user settings
  app.get('/v1/settings', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'viewer')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    await db.claimLegacyUserSettings(request.user.id, request.user.sub);
    const settings = await db.getUserSettings(request.user.id);
    return { settings: settings ?? null };
  });

  // PUT /v1/settings - Update user settings
  app.put<{ Body: unknown }>('/v1/settings', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'viewer')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const bodyResult = UserSettingsSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error });
    }

    await db.claimLegacyUserSettings(request.user.id, request.user.sub);
    const saved = await db.upsertUserSettings(request.user.id, bodyResult.data);
    return { settings: saved };
  });
}
