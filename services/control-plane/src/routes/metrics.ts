import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { registry } from '../metrics.js';

function getBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice('Bearer '.length);
}

function getHeaderToken(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

export function registerMetricsRoutes(app: FastifyInstance): void {
  app.get('/metrics', async (request, reply) => {
    const expected = config.METRICS_TOKEN;
    if (expected) {
      const bearer = getBearerToken(request.headers.authorization);
      const direct = getHeaderToken(request.headers['x-metrics-token']);
      const provided = bearer ?? direct;
      if (provided !== expected) {
        return reply.status(401).send('Unauthorized\n');
      }
    }

    const body = await registry.metrics();
    reply.header('Content-Type', registry.contentType);
    reply.header('Cache-Control', 'no-store');
    return body;
  });
}

