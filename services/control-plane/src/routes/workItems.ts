import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateWorkItemSchema,
  WorkItemStatusSchema,
  WorkItemsQuerySchema,
} from '@agent-command/schema';
import * as automationDb from '../db/automationMemory.js';
import { hasRole } from '../auth/rbac.js';
import { pubsub } from '../services/pubsub.js';

const UpdateWorkItemSchema = z.object({
  status: WorkItemStatusSchema.optional(),
  priority: z.number().int().optional(),
  assigned_automation_agent_id: z.string().uuid().nullable().optional(),
});

export function registerWorkItemRoutes(app: FastifyInstance): void {
  app.get('/v1/work-items', async (request, reply) => {
    const query = WorkItemsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters', details: query.error });
    }

    const work_items = await automationDb.listWorkItems(request.user!.id, query.data);
    return { work_items };
  });

  app.post<{ Body: unknown }>('/v1/work-items', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'operator')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const body = CreateWorkItemSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: body.error });
    }

    const work_item = await automationDb.createWorkItem(request.user.id, body.data);
    pubsub.publishWorkItemUpdated(work_item);
    return { work_item };
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/v1/work-items/:id',
    async (request, reply) => {
      if (!request.user || !hasRole(request.user, 'operator')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const body = UpdateWorkItemSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: body.error });
      }

      const existing = await automationDb.getWorkItemById(request.user.id, request.params.id);
      if (!existing) {
        return reply.status(404).send({ error: 'Work item not found' });
      }

      let work_item = existing;
      if (body.data.status && ['done', 'cancelled', 'blocked'].includes(body.data.status)) {
        const updated = await automationDb.completeWorkItem(
          existing.id,
          body.data.status as 'done' | 'cancelled' | 'blocked'
        );
        if (updated) {
          work_item = updated;
        }
      } else {
        const updated = await automationDb.updateWorkItem(request.user.id, existing.id, {
          status: body.data.status,
          priority: body.data.priority,
          assigned_automation_agent_id: body.data.assigned_automation_agent_id,
        });
        if (updated) {
          work_item = updated;
        }
      }

      pubsub.publishWorkItemUpdated(work_item);
      return { work_item };
    }
  );
}
