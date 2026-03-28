import { z } from 'zod';
import 'dotenv/config';

const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().default(8080),
  JWT_SECRET: z.string().min(16),
  METRICS_TOKEN: z.string().min(1).optional(),
  TAILNET_DOMAIN: z.string().optional(),
  APP_BASE_URL: z.string().url().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  INTEGRATION_SERVICE_TOKENS_JSON: z.string().optional(),
  INTEGRATION_WEBHOOK_SECRET: z.string().min(16).optional(),
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
