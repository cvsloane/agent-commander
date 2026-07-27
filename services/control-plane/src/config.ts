import { z } from 'zod';
import 'dotenv/config';

const OptionalPositiveInteger = z.preprocess(
  (value) => value === '' || value === undefined ? undefined : value,
  z.coerce.number().int().positive().optional()
);

const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().default(8080),
  READINESS_DB_TIMEOUT_MS: z.coerce.number().int().positive().default(2_000),
  JWT_SECRET: z.string().min(16),
  METRICS_TOKEN: z.string().min(1).optional(),
  TAILNET_DOMAIN: z.string().optional(),
  APP_BASE_URL: z.string().url().optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  WS_ALLOWED_ORIGINS: z.string().optional(),
  WS_TICKET_TTL_SECONDS: z.coerce.number().int().positive().max(300).default(30),
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().regex(/^(mailto:|https:)/).optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  INTEGRATION_SERVICE_TOKENS_JSON: z.string().optional(),
  INTEGRATION_WEBHOOK_SECRET: z.string().min(16).optional(),
  DATA_RETENTION_DAYS: OptionalPositiveInteger,
  DATA_RETENTION_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(6 * 60 * 60 * 1000),
  APPROVAL_TIMEOUT_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  APPROVAL_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(60 * 1000),
});

const parseConfig = () => {
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Configuration error:', result.error.format());
    process.exit(1);
  }
  return result.data;
};

export const config = parseConfig();
