import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { generateSummary, isSummarizerAvailable } from '../services/summarizer.js';
import { getSummaryByCaptureHash, saveSummary } from '../db/index.js';

const GenerateSummaryBodySchema = z.object({
  session_id: z.string().uuid().optional(),
  capture_hash: z.string().trim().min(1),
  action_type: z.string().trim().min(1),
  context: z.string().trim().min(1),
  question: z.string().trim().min(1),
});
type GenerateSummaryBody = z.infer<typeof GenerateSummaryBodySchema>;

/**
 * Register summary generation routes
 */
export function registerSummaryRoutes(app: FastifyInstance): void {
  // Check if summarizer is available
  app.get('/v1/summaries/status', async () => {
    return {
      available: isSummarizerAvailable(),
    };
  });

  // Generate summary (with caching)
  app.post(
    '/v1/summaries/generate',
    async (
      request: FastifyRequest<{ Body: GenerateSummaryBody }>,
      reply
    ) => {
      if (!isSummarizerAvailable()) {
        return reply.status(503).send({
          error: 'Summary service unavailable - OPENAI_API_KEY not configured',
        });
      }

      const body = GenerateSummaryBodySchema.safeParse(request.body ?? {});
      if (!body.success) {
        return reply.status(400).send({
          error: 'Invalid summary request',
          details: body.error,
        });
      }
      const { session_id, capture_hash, action_type, context, question } = body.data;

      // Check database cache
      try {
        const cached = await getSummaryByCaptureHash(capture_hash);
        if (cached) {
          app.log.debug({ session_id, capture_hash }, 'Summary database cache hit');
          return {
            summary: cached.summary,
            cached: true,
          };
        }
      } catch (dbError) {
        app.log.warn({ error: dbError }, 'Failed to check summary cache, continuing to generate');
      }

      // Generate new summary
      try {
        app.log.info(
          { session_id, capture_hash, action_type },
          'Generating AI summary'
        );

        const summary = await generateSummary({
          context,
          question,
          actionType: action_type,
        });

        // Save to database
        try {
          await saveSummary(capture_hash, session_id ?? null, action_type, summary);
          app.log.debug({ capture_hash }, 'Summary saved to database');
        } catch (saveError) {
          app.log.warn({ error: saveError }, 'Failed to save summary to database');
        }

        return {
          summary,
          cached: false,
        };
      } catch (error) {
        app.log.error({ error, session_id }, 'Failed to generate summary');
        return reply.status(500).send({
          error: error instanceof Error ? error.message : 'Failed to generate summary',
        });
      }
    }
  );
}
