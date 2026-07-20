import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';

export interface HttpSecurityOptions {
  appBaseUrl?: string;
  rateLimitMax: number;
  rateLimitTimeWindowMs: number;
}

function requestPath(request: FastifyRequest): string {
  return request.url.split('?', 1)[0] || request.url;
}

function isRateLimitExempt(request: FastifyRequest): boolean {
  return requestPath(request) === '/health';
}

export async function registerHttpSecurity(
  app: FastifyInstance,
  options: HttpSecurityOptions
): Promise<void> {
  const appOrigin = options.appBaseUrl ? new URL(options.appBaseUrl).origin : null;
  if (!appOrigin) {
    app.log.warn(
      'APP_BASE_URL is not set; retaining reflective CORS behavior. Set APP_BASE_URL in production.'
    );
  }

  await app.register(cors, {
    origin: appOrigin ? [appOrigin] : true,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
  });

  await app.register(rateLimit, {
    global: true,
    max: options.rateLimitMax,
    timeWindow: options.rateLimitTimeWindowMs,
    allowList: isRateLimitExempt,
  });
}
