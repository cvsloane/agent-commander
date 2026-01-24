import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RecordTokenUsageRequestSchema, UpdateApprovalMetricsRequestSchema } from '@agent-command/schema';
import * as db from '../db/index.js';

const AnalyticsQuerySchema = z.object({
  host_id: z.string().uuid().optional(),
  provider: z.string().optional(),
  since: z.string().datetime().optional(),
});

const TimeSeriesQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(1000).default(100),
});

const ProviderUsageQuerySchema = z.object({
  provider: z.string().optional(),
  host_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  scope: z.enum(['account', 'session']).optional(),
});

export function registerAnalyticsRoutes(app: FastifyInstance): void {
  // GET /v1/analytics/usage/weekly - Get weekly usage data
  app.get('/v1/analytics/usage/weekly', async () => {
    const usage = await db.getWeeklyUsage();
    return usage;
  });

  // GET /v1/analytics/summary - Get aggregate analytics
  app.get('/v1/analytics/summary', async (request, reply) => {
    const query = AnalyticsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters' });
    }

    const summary = await db.getAnalyticsSummary(query.data);
    return summary;
  });

  // GET /v1/analytics/provider-usage - Get latest provider-reported usage/quota
  app.get('/v1/analytics/provider-usage', async (request, reply) => {
    const query = ProviderUsageQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query parameters' });
    }

    const usage = await db.getLatestProviderUsage(query.data);
    return { usage };
  });

  // GET /v1/sessions/:id/analytics - Get analytics for a specific session
  app.get<{ Params: { id: string } }>(
    '/v1/sessions/:id/analytics',
    async (request, reply) => {
      const { id } = request.params;

      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      const metrics = await db.getSessionMetrics(id);
      if (!metrics) {
        // Return empty metrics if none exist yet
        return {
          session_id: id,
          tokens_in: 0,
          tokens_out: 0,
          tokens_cache_read: 0,
          tokens_cache_write: 0,
          tool_calls: 0,
          approvals_requested: 0,
          approvals_granted: 0,
          approvals_denied: 0,
          first_event_at: null,
          last_event_at: null,
          estimated_cost_cents: 0,
        };
      }

      return metrics;
    }
  );

  // GET /v1/sessions/:id/analytics/timeseries - Get token usage time series
  app.get<{ Params: { id: string }; Querystring: unknown }>(
    '/v1/sessions/:id/analytics/timeseries',
    async (request, reply) => {
      const { id } = request.params;

      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({ error: 'Invalid session ID' });
      }

      const query = TimeSeriesQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send({ error: 'Invalid query parameters' });
      }

      const timeSeries = await db.getTokenUsageTimeSeries(id, { limit: query.data.limit });
      return { data: timeSeries };
    }
  );

  // POST /v1/analytics/token-usage - Record token usage (from agentd)
  app.post<{ Body: unknown }>('/v1/analytics/token-usage', async (request, reply) => {
    const bodyResult = RecordTokenUsageRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error });
    }

    await db.recordTokenUsage(bodyResult.data);
    return { success: true };
  });

  // POST /v1/analytics/approval-metrics - Update approval metrics (from agentd)
  app.post<{ Body: unknown }>('/v1/analytics/approval-metrics', async (request, reply) => {
    const bodyResult = UpdateApprovalMetricsRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error });
    }

    await db.updateApprovalMetrics(bodyResult.data.session_id, bodyResult.data.action);
    return { success: true };
  });
}
