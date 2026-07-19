import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AutomationAgentMessageRequestSchema,
  AutomationRunReportRequestSchema,
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
  AutomationRunReportError,
  reportAutomationRunById,
} from '../services/automation.js';
import { sendInputToSession } from '../services/sessionSpawn.js';
import * as db from '../db/index.js';

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

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/v1/automation-runs/:id/report',
    async (request, reply) => {
      if (!request.user || !['service', 'session'].includes(request.user.auth_type)) {
        return reply.status(403).send({ error: 'Service or session authentication required' });
      }
      if (!z.string().uuid().safeParse(request.params.id).success) {
        return reply.status(400).send({ error: 'Invalid automation run ID' });
      }
      const body = AutomationRunReportRequestSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: body.error });
      }

      try {
        const finalized = await reportAutomationRunById({
          user_id: request.user.id,
          run_id: request.params.id,
          session_id: request.user.auth_type === 'session'
            ? request.user.session_id
            : undefined,
          allow_unscoped: request.user.auth_type === 'service',
          report: body.data,
        });
        return {
          run: finalized.run,
          replayed: finalized.replayed,
        };
      } catch (error) {
        if (error instanceof AutomationRunReportError) {
          return reply.status(error.statusCode).send({ error: error.message });
        }
        throw error;
      }
    }
  );

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

  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/v1/automation-agents/:slug/message',
    async (request, reply) => {
      if (
        !request.user
        || (request.user.auth_type !== 'service' && !hasRole(request.user, 'operator'))
      ) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      const body = AutomationAgentMessageRequestSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: body.error });
      }

      const agent = await automationDb.getAutomationAgentBySlug(request.params.slug);
      if (
        !agent
        || (request.user.auth_type !== 'service' && agent.user_id !== request.user.id)
      ) {
        return reply.status(404).send({ error: 'Automation agent not found' });
      }
      const runtime = await automationDb.getActiveAutomationRuntimeForAgent(agent.id);
      if (!runtime?.active_session_id) {
        return reply.status(409).send({ error: 'Automation agent has no attached runtime session' });
      }
      const session = await db.getSessionById(runtime.active_session_id);
      if (!session || session.status === 'DONE' || session.status === 'ERROR') {
        return reply.status(409).send({ error: 'Automation agent runtime session is not active' });
      }

      try {
        const cmdId = await sendInputToSession({
          host_id: session.host_id,
          session_id: session.id,
          text: body.data.message,
          enter: body.data.enter,
        });
        try {
          await db.createAuditLog(
            'automation.agent_message',
            'session',
            session.id,
            {
              automation_agent_id: agent.id,
              automation_agent_slug: agent.slug,
              cmd_id: cmdId,
              integration_source: request.user.service_name || request.user.auth_type,
            },
            request.user.id
          );
        } catch (error) {
          request.log.warn({ error, sessionId: session.id }, 'Failed to audit automation agent message');
        }
        return { automation_agent_id: agent.id, session_id: session.id, cmd_id: cmdId };
      } catch (error) {
        const message = (error as Error).message;
        const status = message === 'Session not found' ? 404 : 503;
        return reply.status(status).send({ error: message });
      }
    }
  );
}
