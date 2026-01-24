import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ApprovalDecideRequestSchema,
  ApprovalsDecisionMessageSchema,
} from '@agent-command/schema';
import * as db from '../db/index.js';
import { pubsub } from '../services/pubsub.js';
import { hasRole } from '../auth/rbac.js';

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

      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid approval ID' });
      }

      const bodyResult = ApprovalDecideRequestSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error });
      }

      const { decision, mode, payload } = bodyResult.data;

      // Get approval and session
      const approval = await db.getApprovalById(id);
      if (!approval) {
        return reply.status(404).send({ error: 'Approval not found' });
      }

      if (approval.decision) {
        return reply.status(409).send({ error: 'Approval already decided' });
      }
      if (approval.timed_out_at) {
        return reply.status(409).send({ error: 'Approval is no longer active' });
      }

      const session = await db.getSessionById(approval.session_id);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      // Update approval in database
      const decidedPayload = { mode, ...payload };
      const updatedApproval = await db.decideApproval(
        id,
        decision,
        decidedPayload
        // TODO: Add user ID from auth
      );

      if (!updatedApproval) {
        return reply.status(409).send({ error: 'Approval already decided' });
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

      // Send to agent
      pubsub.sendToAgent(session.host_id, decisionMessage);

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
        { decision, mode, session_id: approval.session_id }
        // TODO: Add user ID from auth
      );

      return { approval: updatedApproval };
    }
  );
}
