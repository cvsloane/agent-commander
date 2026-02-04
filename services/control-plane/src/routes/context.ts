import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UpsertContextSchema } from '@agent-command/schema';
import * as db from '../db/index.js';
import { hasRole } from '../auth/rbac.js';

export function registerContextRoutes(app: FastifyInstance): void {
  // GET /v1/sessions/:id/context - List all context keys
  app.get<{ Params: { id: string } }>(
    '/v1/sessions/:id/context',
    async (request, reply) => {
      const { id: sessionId } = request.params;

      if (!z.string().uuid().safeParse(sessionId).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      const session = await db.getSessionById(sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const context = await db.listSessionContext(sessionId);

      return {
        context: context.map((c) => ({
          key: c.key,
          value: c.value,
          updated_at: c.updated_at,
        })),
      };
    }
  );

  // GET /v1/sessions/:id/context/:key - Get value
  app.get<{ Params: { id: string; key: string } }>(
    '/v1/sessions/:id/context/:key',
    async (request, reply) => {
      const { id: sessionId, key } = request.params;

      if (!z.string().uuid().safeParse(sessionId).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      if (!key || key.length > 255) {
        return reply.status(400).send({ error: 'Invalid key' });
      }

      const session = await db.getSessionById(sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const context = await db.getSessionContext(sessionId, key);
      if (!context) {
        return reply.status(404).send({ error: 'Key not found' });
      }

      return {
        key: context.key,
        value: context.value,
        updated_at: context.updated_at,
      };
    }
  );

  // PUT /v1/sessions/:id/context/:key - Set value
  app.put<{ Params: { id: string; key: string }; Body: unknown }>(
    '/v1/sessions/:id/context/:key',
    async (request, reply) => {
      if (!request.user || !hasRole(request.user, 'operator')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const { id: sessionId, key } = request.params;

      if (!z.string().uuid().safeParse(sessionId).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      if (!key || key.length > 255) {
        return reply.status(400).send({ error: 'Invalid key' });
      }

      const bodyResult = UpsertContextSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error });
      }

      const session = await db.getSessionById(sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const context = await db.upsertSessionContext(sessionId, key, bodyResult.data.value);

      // Log audit
      await db.createAuditLog('session.context.upsert', 'session_context', context.id, {
        session_id: sessionId,
        key,
        value_length: bodyResult.data.value.length,
      }, request.user.id);

      return {
        key: context.key,
        value: context.value,
        updated_at: context.updated_at,
      };
    }
  );

  // DELETE /v1/sessions/:id/context/:key - Delete key
  app.delete<{ Params: { id: string; key: string } }>(
    '/v1/sessions/:id/context/:key',
    async (request, reply) => {
      if (!request.user || !hasRole(request.user, 'operator')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const { id: sessionId, key } = request.params;

      if (!z.string().uuid().safeParse(sessionId).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      if (!key || key.length > 255) {
        return reply.status(400).send({ error: 'Invalid key' });
      }

      const session = await db.getSessionById(sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const deleted = await db.deleteSessionContext(sessionId, key);
      if (!deleted) {
        return reply.status(404).send({ error: 'Key not found' });
      }

      // Log audit
      await db.createAuditLog('session.context.delete', 'session_context', sessionId, {
        session_id: sessionId,
        key,
      }, request.user.id);

      return { success: true };
    }
  );
}
