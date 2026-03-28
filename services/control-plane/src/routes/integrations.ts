import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { WakeAutomationAgentRequestSchema } from '@agent-command/schema';
import { config } from '../config.js';
import * as db from '../db/index.js';
import * as automationDb from '../db/automationMemory.js';
import { pubsub } from '../services/pubsub.js';
import { recordAutomationWakeup } from '../metrics.js';
import { listAutomationAgentViews } from '../services/automation.js';

const RecentRunsQuerySchema = z.object({
  hours: z.coerce.number().min(1).max(168).default(24),
  limit: z.coerce.number().min(1).max(100).default(20),
});

function buildAppUrl(path: string): string {
  if (!config.APP_BASE_URL) {
    return path;
  }
  return `${config.APP_BASE_URL.replace(/\/+$/, '')}${path}`;
}

function canUseIntegrationRoutes(requestUser: { role: string; auth_type?: string } | undefined): boolean {
  if (!requestUser) return false;
  return requestUser.auth_type === 'service' || requestUser.role === 'operator' || requestUser.role === 'admin';
}

function secureEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function verifyWebhookSignature(payload: unknown, headers: Record<string, unknown>): boolean {
  if (!config.INTEGRATION_WEBHOOK_SECRET) {
    return false;
  }

  const timestamp = String(headers['x-agent-command-timestamp'] || '').trim();
  const signature = String(headers['x-agent-command-signature'] || '').trim();
  if (!timestamp || !signature) {
    return false;
  }

  const unixSeconds = Number(timestamp);
  if (!Number.isFinite(unixSeconds)) {
    return false;
  }
  if (Math.abs(Date.now() - unixSeconds * 1000) > 5 * 60_000) {
    return false;
  }

  const encodedBody = JSON.stringify(payload ?? {});
  const expected = `sha256=${createHmac('sha256', config.INTEGRATION_WEBHOOK_SECRET)
    .update(`${timestamp}.${encodedBody}`)
    .digest('hex')}`;
  return secureEquals(expected, signature);
}

export function registerIntegrationRoutes(app: FastifyInstance): void {
  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/v1/integrations/automation-agents/:slug/wake',
    async (request, reply) => {
      if (!canUseIntegrationRoutes(request.user)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const body = WakeAutomationAgentRequestSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: body.error });
      }

      const agent = await automationDb.getAutomationAgentBySlug(request.params.slug);
      if (!agent) {
        return reply.status(404).send({ error: 'Automation agent not found' });
      }

      const wakeup = await automationDb.createAutomationWakeup(agent.user_id, agent.id, {
        ...body.data,
        source: 'external',
        context_json: {
          ...(body.data.context_json ?? {}),
          integration_source: request.user?.service_name || 'operator',
        },
      });
      pubsub.publishAutomationWakeupUpdated(wakeup);
      recordAutomationWakeup(wakeup.status, wakeup.source);
      return { wakeup };
    }
  );

  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/v1/integrations/webhooks/automation-agents/:slug/wake',
    async (request, reply) => {
      const body = WakeAutomationAgentRequestSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: body.error });
      }
      if (!verifyWebhookSignature(body.data, request.headers as Record<string, unknown>)) {
        return reply.status(401).send({ error: 'Invalid webhook signature' });
      }

      const agent = await automationDb.getAutomationAgentBySlug(request.params.slug);
      if (!agent) {
        return reply.status(404).send({ error: 'Automation agent not found' });
      }

      const wakeup = await automationDb.createAutomationWakeup(agent.user_id, agent.id, {
        ...body.data,
        source: 'external',
        context_json: {
          ...(body.data.context_json ?? {}),
          integration_source: 'webhook',
        },
      });
      pubsub.publishAutomationWakeupUpdated(wakeup);
      recordAutomationWakeup(wakeup.status, wakeup.source);
      return { wakeup };
    }
  );

  app.get('/v1/integrations/hermes/watchdog-summary', async (request, reply) => {
    if (!canUseIntegrationRoutes(request.user)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const [agents, hosts, approvals, runs, wakeups] = await Promise.all([
      listAutomationAgentViews(request.user!.id),
      db.getHosts(),
      automationDb.listGovernanceApprovals(request.user!.id, { status: 'pending' }),
      automationDb.listAutomationRuns(request.user!.id, { limit: 25 }),
      automationDb.listAutomationWakeups(request.user!.id, { limit: 25 }),
    ]);

    const degradedHosts = hosts
      .map((host) => {
        const capabilities = (host.capabilities ?? {}) as Record<string, unknown>;
        const providers = capabilities.providers && typeof capabilities.providers === 'object'
          ? capabilities.providers as Record<string, unknown>
          : {};
        const issues: string[] = [];
        if (!pubsub.isAgentConnected(host.id)) issues.push('offline');
        if (Object.keys(providers).length === 0) issues.push('provider_map_missing');
        return issues.length > 0 ? {
          id: host.id,
          name: host.name,
          issues,
        } : null;
      })
      .filter(Boolean);

    const preflightCounts = agents.reduce(
      (acc, agent) => {
        acc[agent.preflight?.status || 'ok'] += 1;
        return acc;
      },
      { ok: 0, warn: 0, blocked: 0 }
    );

    return {
      generated_at: new Date().toISOString(),
      hosts: {
        total: hosts.length,
        connected: hosts.filter((host) => pubsub.isAgentConnected(host.id)).length,
        degraded: degradedHosts,
      },
      automation: {
        total_agents: agents.length,
        active_agents: agents.filter((agent) => agent.status === 'active').length,
        preflight: preflightCounts,
        active_runs: runs.filter((run) => run.status === 'running' || run.status === 'starting').length,
        blocked_runs: runs.filter((run) => run.status === 'blocked').length,
        open_wakeups: wakeups.filter((wakeup) => wakeup.status === 'queued' || wakeup.status === 'running').length,
      },
      blocked_agents: agents
        .filter((agent) => agent.preflight?.status === 'blocked')
        .map((agent) => ({
          id: agent.id,
          slug: agent.slug,
          name: agent.name,
          issues: agent.preflight?.issues ?? [],
          url: buildAppUrl('/automation'),
        })),
      governance_pending_count: approvals.length,
    };
  });

  app.get('/v1/integrations/hermes/governance-summary', async (request, reply) => {
    if (!canUseIntegrationRoutes(request.user)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const [agents, approvals, blockedRuns] = await Promise.all([
      listAutomationAgentViews(request.user!.id),
      automationDb.listGovernanceApprovals(request.user!.id, { status: 'pending' }),
      automationDb.listAutomationRuns(request.user!.id, { status: 'blocked', limit: 20 }),
    ]);
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));

    return {
      generated_at: new Date().toISOString(),
      pending_count: approvals.length,
      approvals: approvals.map((approval) => {
        const agent = agentById.get(approval.automation_agent_id);
        return {
          id: approval.id,
          type: approval.type,
          status: approval.status,
          requested_at: approval.requested_at,
          reason: approval.request_payload?.reason ?? null,
          agent: agent ? {
            id: agent.id,
            slug: agent.slug,
            name: agent.name,
          } : null,
          url: buildAppUrl('/automation'),
        };
      }),
      blocked_runs: blockedRuns.map((run) => {
        const agent = agentById.get(run.automation_agent_id);
        return {
          id: run.id,
          status: run.status,
          summary: run.result_summary,
          agent: agent ? { slug: agent.slug, name: agent.name } : null,
          session_id: run.session_id,
          url: buildAppUrl('/automation'),
        };
      }),
    };
  });

  app.get<{ Querystring: unknown }>('/v1/integrations/hermes/recent-runs-summary', async (request, reply) => {
    if (!canUseIntegrationRoutes(request.user)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const query = RecentRunsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters', details: query.error });
    }

    const [agents, runs] = await Promise.all([
      listAutomationAgentViews(request.user!.id),
      automationDb.listAutomationRuns(request.user!.id, { limit: query.data.limit }),
    ]);
    const cutoff = Date.now() - query.data.hours * 60 * 60_000;
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    const recentRuns = runs.filter((run) => {
      const startedAt = run.started_at ? new Date(run.started_at).getTime() : 0;
      return startedAt === 0 || startedAt >= cutoff;
    });

    return {
      generated_at: new Date().toISOString(),
      hours: query.data.hours,
      counts: recentRuns.reduce(
        (acc, run) => {
          acc[run.status] = (acc[run.status] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      ),
      runs: recentRuns.map((run) => {
        const agent = agentById.get(run.automation_agent_id);
        return {
          id: run.id,
          status: run.status,
          objective: run.objective,
          summary: run.result_summary,
          started_at: run.started_at,
          ended_at: run.ended_at,
          agent: agent ? {
            id: agent.id,
            slug: agent.slug,
            name: agent.name,
          } : null,
          session_id: run.session_id,
          session_url: run.session_id ? buildAppUrl(`/sessions/${run.session_id}`) : null,
          run_url: buildAppUrl('/automation'),
          worker_report: run.worker_report_json ?? {},
          log_ref: run.log_ref_json ?? {},
        };
      }),
    };
  });
}
