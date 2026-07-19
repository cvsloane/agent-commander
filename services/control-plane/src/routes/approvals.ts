import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ApprovalDecideRequestSchema,
  ApprovalsDecisionMessageSchema,
} from '@agent-command/schema';
import * as db from '../db/index.js';
import { decideApprovalAndEnqueue } from '../db/commandOutbox.js';
import { pubsub } from '../services/pubsub.js';
import { hasRole } from '../auth/rbac.js';
import { commandRouter } from '../services/commandRouter.js';
import {
  assertIdempotencyFingerprint,
  fingerprintIdempotentRequest,
  getIdempotencyKey,
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
  scopeIdempotencyKey,
} from '../services/idempotency.js';

const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

// Query schema
const ApprovalsQuerySchema = z.object({
  status: z.enum(['pending', 'decided']).optional(),
  session_id: z.string().uuid().optional(),
});

export function registerApprovalRoutes(app: FastifyInstance): void {
  // GET /v1/approvals - List approvals
  app.get('/v1/approvals', async (request, reply) => {
    const query = ApprovalsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters' });
    }

    const approvals = await db.getApprovals(query.data);
    return { approvals };
  });

  // GET /v1/approvals/:id - Get single approval
  app.get<{ Params: { id: string } }>('/v1/approvals/:id', async (request, reply) => {
    const { id } = request.params;

    if (!z.string().uuid().safeParse(id).success) {
      return reply.status(400).send({ error: 'Invalid approval ID' });
    }

    const approval = await db.getApprovalById(id);
    if (!approval) {
      return reply.status(404).send({ error: 'Approval not found' });
    }

    return { approval };
  });

  // POST /v1/approvals/:id/decide - Decide on approval
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/v1/approvals/:id/decide',
    async (request, reply) => {
      if (!request.user || !hasRole(request.user, 'operator')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      const { id } = request.params;

      let rawIdempotencyKey: string | undefined;
      try {
        rawIdempotencyKey = getIdempotencyKey(request.headers['idempotency-key']);
      } catch (error) {
        if (error instanceof InvalidIdempotencyKeyError) {
          return reply.status(400).send({ error: error.message });
        }
        throw error;
      }

      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid approval ID' });
      }

      const bodyResult = ApprovalDecideRequestSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error });
      }

      const { decision, mode, payload } = bodyResult.data;
      const idempotencyKey = scopeIdempotencyKey(
        rawIdempotencyKey,
        'approvals.decide',
        request.user.id
      );
      const idempotencyFingerprint = rawIdempotencyKey
        ? fingerprintIdempotentRequest({ approval_id: id, ...bodyResult.data })
        : undefined;

      // Get approval and session
      const approval = await db.getApprovalById(id);
      if (!approval) {
        return reply.status(404).send({ error: 'Approval not found' });
      }

      const session = await db.getSessionById(approval.session_id);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const findIdempotentReplay = async () => {
        if (!idempotencyKey) return null;
        const existing = await commandRouter.getByIdempotencyKey(
          session.host_id,
          idempotencyKey
        );
        if (!existing) return null;

        assertIdempotencyFingerprint(
          existing.idempotency_fingerprint,
          idempotencyFingerprint
        );
        const wirePayload = existing.payload.payload;
        const originalApprovalId = wirePayload && typeof wirePayload === 'object'
          ? (wirePayload as Record<string, unknown>).approval_id
          : null;
        if (originalApprovalId !== id || existing.type !== 'approvals.decision') {
          throw new IdempotencyConflictError('Idempotency-Key was used for another request');
        }
        const originalApproval = await db.getApprovalById(originalApprovalId);
        if (!originalApproval) {
          throw new IdempotencyConflictError('Original idempotent result is unavailable');
        }
        return originalApproval;
      };

      try {
        const replay = await findIdempotentReplay();
        if (replay) return { approval: replay };
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          return reply.status(409).send({ error: error.message });
        }
        throw error;
      }

      if (approval.decision) {
        return reply.status(409).send({ error: 'Approval already decided' });
      }
      if (approval.timed_out_at) {
        return reply.status(409).send({ error: 'Approval is no longer active' });
      }
      const expiresAt = new Date(
        new Date(approval.ts_requested).getTime() + APPROVAL_TIMEOUT_MS
      );
      if (expiresAt.getTime() <= Date.now()) {
        return reply.status(409).send({ error: 'Approval is no longer active' });
      }

      // Build decision message for agent
      const decisionMessage = ApprovalsDecisionMessageSchema.parse({
        v: 1,
        type: 'approvals.decision',
        ts: new Date().toISOString(),
        payload: {
          approval_id: id,
          session_id: approval.session_id,
          decision,
          mode,
          updated_input: payload?.updatedInput,
        },
      });

      const cmdId = randomUUID();
      let decided;
      try {
        decided = await decideApprovalAndEnqueue({
          approval_id: id,
          decision,
          decided_payload: { mode, ...payload },
          decided_by_user_id: request.user.id,
          command: {
            cmd_id: cmdId,
            host_id: session.host_id,
            payload: decisionMessage,
            type: decisionMessage.type,
            class: 'durable',
            session_id: approval.session_id,
            expires_at: expiresAt,
            idempotency_key: idempotencyKey,
            idempotency_fingerprint: idempotencyFingerprint,
          },
        });
      } catch (error) {
        if ((error as { code?: string }).code !== '23505') throw error;
      }

      if (!decided) {
        try {
          const replay = await findIdempotentReplay();
          if (replay) return { approval: replay };
        } catch (error) {
          if (error instanceof IdempotencyConflictError) {
            return reply.status(409).send({ error: error.message });
          }
          throw error;
        }
        return reply.status(409).send({ error: 'Approval already decided' });
      }

      // The update and enqueue commit together. Delivery happens only after
      // commit; one-way legacy approvals are completed on their first send.
      await commandRouter.deliverPersisted(decided.command);

      // Clear session metadata (approval and status_detail)
      const updatedSession = await db.clearSessionApprovalMetadata(approval.session_id);
      if (updatedSession) {
        pubsub.publishSessionsChanged([updatedSession]);
      }

      // Publish update to UI clients
      pubsub.publishApprovalUpdated(id, decision);

      // Update analytics metrics
      await db.updateApprovalMetrics(
        approval.session_id,
        decision === 'allow' ? 'granted' : 'denied'
      );

      // Log audit
      await db.createAuditLog(
        'approval.decide',
        'approval',
        id,
        { decision, mode, session_id: approval.session_id },
        request.user.id
      );

      return { approval: decided.approval };
    }
  );
}
