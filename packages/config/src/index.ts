import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  API_PORT: z.coerce.number().default(3000),
  WEB_PORT: z.coerce.number().default(5173),
  STUDIO_PORT: z.coerce.number().default(5174),
  PORTAL_PORT: z.coerce.number().default(5175),
  WORKER_CONCURRENCY: z.coerce.number().default(4),
  JWT_SECRET: z.string().min(8),
  TENANT_INTERNAL_UUID: z.string().uuid(),
  TENANT_EXTERNAL_UUID: z.string().uuid(),
  DATABASE_URL_API: z.string().min(1),
  DATABASE_URL_WORKER: z.string().min(1),
  DATABASE_URL_ROOT: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ARTIFACTS_DIR: z.string().min(1)
});

export type AppEnv = z.infer<typeof EnvSchema>;

export const loadEnv = (input: Record<string, string | undefined> = process.env): AppEnv => {
  return EnvSchema.parse(input);
};
