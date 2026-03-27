import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GovernanceApprovalDecisionRequestSchema } from '@agent-command/schema';
import * as automationDb from '../db/automationMemory.js';
import { hasRole } from '../auth/rbac.js';
import { pubsub } from '../services/pubsub.js';
import { recordGovernanceApproval } from '../metrics.js';

const GovernanceApprovalsQuerySchema = z.object({
  status: z.string().optional(),
});

export function registerGovernanceApprovalRoutes(app: FastifyInstance): void {
  app.get('/v1/governance-approvals', async (request, reply) => {
    const query = GovernanceApprovalsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters', details: query.error });
    }

    const approvals = await automationDb.listGovernanceApprovals(request.user!.id, query.data);
    return { approvals };
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/v1/governance-approvals/:id/decide',
    async (request, reply) => {
      if (!request.user || !hasRole(request.user, 'operator')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      const body = GovernanceApprovalDecisionRequestSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: body.error });
      }

      const approval = await automationDb.decideGovernanceApproval(
        request.user.id,
        request.params.id,
        request.user.id,
        body.data
      );
      if (!approval) {
        return reply.status(404).send({ error: 'Governance approval not found or already decided' });
      }

      pubsub.publishGovernanceApprovalUpdated(approval);
      recordGovernanceApproval(approval.status, approval.type);
      return { approval };
    }
  );
}
