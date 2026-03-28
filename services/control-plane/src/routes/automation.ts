import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  UpsertAutomationAgentSchema,
  WakeAutomationAgentRequestSchema,
} from '@agent-command/schema';
import * as automationDb from '../db/automationMemory.js';
import { hasRole } from '../auth/rbac.js';
import { pubsub } from '../services/pubsub.js';
import { recordAutomationWakeup } from '../metrics.js';
import {
  getAutomationAgentPreflight,
  getAutomationAgentView,
  getAutomationRunEvents,
  listAutomationAgentViews,
} from '../services/automation.js';

const AutomationRunsQuerySchema = z.object({
  automation_agent_id: z.string().uuid().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
});

const AutomationWakeupsQuerySchema = z.object({
  automation_agent_id: z.string().uuid().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
});

const AutomationAgentPreflightQuerySchema = z.object({
  repo_id: z.string().uuid().optional(),
});

export function registerAutomationRoutes(app: FastifyInstance): void {
  app.get('/v1/automation-agents', async (request) => {
    const agents = await listAutomationAgentViews(request.user!.id);
    return { agents };
  });

  app.post<{ Body: unknown }>('/v1/automation-agents', async (request, reply) => {
    if (!request.user || !hasRole(request.user, 'operator')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const body = UpsertAutomationAgentSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: body.error });
    }

    const created = await automationDb.createAutomationAgent(request.user.id, body.data);
    const agent = await getAutomationAgentView(request.user.id, created.id) ?? created;
    return { agent };
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/v1/automation-agents/:id',
    async (request, reply) => {
      if (!request.user || !hasRole(request.user, 'operator')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const body = UpsertAutomationAgentSchema.partial().safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: body.error });
      }

      const updated = await automationDb.updateAutomationAgent(request.user.id, request.params.id, body.data);
      if (!updated) {
        return reply.status(404).send({ error: 'Automation agent not found' });
      }
      const agent = await getAutomationAgentView(request.user.id, updated.id) ?? updated;
      return { agent };
    }
  );

  app.get<{ Params: { id: string }; Querystring: unknown }>(
    '/v1/automation-agents/:id/preflight',
    async (request, reply) => {
      const query = AutomationAgentPreflightQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send({ error: 'Invalid query parameters', details: query.error });
      }

      const preflight = await getAutomationAgentPreflight(
        request.user!.id,
        request.params.id,
        query.data.repo_id
      );
      if (!preflight) {
        return reply.status(404).send({ error: 'Automation agent not found' });
      }
      return { preflight };
    }
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/v1/automation-agents/:id/wake',
    async (request, reply) => {
      if (!request.user || !hasRole(request.user, 'operator')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      const body = WakeAutomationAgentRequestSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: body.error });
      }

      try {
        const wakeup = await automationDb.createAutomationWakeup(
          request.user.id,
          request.params.id,
          body.data
        );
        pubsub.publishAutomationWakeupUpdated(wakeup);
        recordAutomationWakeup(wakeup.status, wakeup.source);
        return { wakeup };
      } catch (error) {
        const message = (error as Error).message;
        const status = message === 'Automation agent not found' ? 404 : 400;
        return reply.status(status).send({ error: message });
      }
    }
  );

  app.get('/v1/automation-runs', async (request, reply) => {
    const query = AutomationRunsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters', details: query.error });
    }

    const runs = await automationDb.listAutomationRuns(request.user!.id, query.data);
    return { runs };
  });

  app.get<{ Params: { id: string } }>(
    '/v1/automation-runs/:id/events',
    async (request) => {
      const events = await getAutomationRunEvents(request.user!.id, request.params.id);
      return { events };
    }
  );

  app.get('/v1/automation-wakeups', async (request, reply) => {
    const query = AutomationWakeupsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters', details: query.error });
    }

    const wakeups = await automationDb.listAutomationWakeups(request.user!.id, query.data);
    return { wakeups };
  });
}
