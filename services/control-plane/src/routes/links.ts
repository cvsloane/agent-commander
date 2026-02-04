import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CreateSessionLinkSchema } from '@agent-command/schema';
import * as db from '../db/index.js';
import { hasRole } from '../auth/rbac.js';

export function registerLinkRoutes(app: FastifyInstance): void {
  // POST /v1/sessions/:id/links - Create link
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/v1/sessions/:id/links',
    async (request, reply) => {
      if (!request.user || !hasRole(request.user, 'operator')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const { id: sourceSessionId } = request.params;

      if (!z.string().uuid().safeParse(sourceSessionId).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      const bodyResult = CreateSessionLinkSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error });
      }

      const { target_session_id, link_type } = bodyResult.data;

      // Verify both sessions exist
      const [sourceSession, targetSession] = await Promise.all([
        db.getSessionById(sourceSessionId),
        db.getSessionById(target_session_id),
      ]);

      if (!sourceSession) {
        return reply.status(404).send({ error: 'Source session not found' });
      }
      if (!targetSession) {
        return reply.status(404).send({ error: 'Target session not found' });
      }

      try {
        const link = await db.createSessionLink(sourceSessionId, target_session_id, link_type);

        // Log audit
        await db.createAuditLog('session.link.create', 'session_link', link.id, {
          source_session_id: sourceSessionId,
          target_session_id,
          link_type,
        }, request.user.id);

        return { link };
      } catch (err) {
        const error = err as Error;
        if (error.message.includes('duplicate') || error.message.includes('unique')) {
          return reply.status(409).send({ error: 'Link already exists' });
        }
        throw err;
      }
    }
  );

  // GET /v1/sessions/:id/links - List links (both directions)
  app.get<{ Params: { id: string } }>(
    '/v1/sessions/:id/links',
    async (request, reply) => {
      const { id: sessionId } = request.params;

      if (!z.string().uuid().safeParse(sessionId).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      const session = await db.getSessionById(sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const links = await db.getSessionLinks(sessionId);

      return { links };
    }
  );

  // DELETE /v1/sessions/:id/links/:linkId - Remove link
  app.delete<{ Params: { id: string; linkId: string } }>(
    '/v1/sessions/:id/links/:linkId',
    async (request, reply) => {
      if (!request.user || !hasRole(request.user, 'operator')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const { id: sessionId, linkId } = request.params;

      if (!z.string().uuid().safeParse(sessionId).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }
      if (!z.string().uuid().safeParse(linkId).success) {
        return reply.status(400).send({ error: 'Invalid link ID' });
      }

      // Verify link exists and belongs to this session
      const link = await db.getSessionLinkById(linkId);
      if (!link) {
        return reply.status(404).send({ error: 'Link not found' });
      }

      if (link.source_session_id !== sessionId && link.target_session_id !== sessionId) {
        return reply.status(403).send({ error: 'Link does not belong to this session' });
      }

      const deleted = await db.deleteSessionLink(linkId);
      if (!deleted) {
        return reply.status(404).send({ error: 'Link not found' });
      }

      // Log audit
      await db.createAuditLog('session.link.delete', 'session_link', linkId, {
        source_session_id: link.source_session_id,
        target_session_id: link.target_session_id,
      }, request.user.id);

      return { success: true };
    }
  );
}
