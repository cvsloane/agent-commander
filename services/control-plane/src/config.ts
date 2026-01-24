import { z } from 'zod';
import 'dotenv/config';

const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().default(8080),
  JWT_SECRET: z.string().min(16),
  TAILNET_DOMAIN: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
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
