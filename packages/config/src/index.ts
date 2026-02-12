import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  ZENOPS_MULTI_TENANT_ENABLED: z.string().default('false'),
  ZENOPS_INTERNAL_TENANT_ID: z.string().uuid(),
  ZENOPS_EXTERNAL_TENANT_ID: z.string().uuid(),
  API_PORT: z.coerce.number().default(3000),
  WEB_PORT: z.coerce.number().default(5173),
  STUDIO_PORT: z.coerce.number().default(5174),
  PORTAL_PORT: z.coerce.number().default(5175),
  WORKER_CONCURRENCY: z.coerce.number().default(4),
  JWT_SECRET: z.string().min(8),
  TENANT_INTERNAL_UUID: z.string().uuid().optional(),
  TENANT_EXTERNAL_UUID: z.string().uuid().optional(),
  DATABASE_URL_API: z.string().min(1),
  DATABASE_URL_WORKER: z.string().min(1),
  DATABASE_URL_ROOT: z.string().min(1),
  REDIS_URL: z.string().min(1),
  WEBHOOKS_ENABLED: z.string().default('false'),
  TWILIO_WEBHOOK_VALIDATE: z.string().optional(),
  SENDGRID_WEBHOOK_VALIDATE: z.string().optional(),
  MAILGUN_WEBHOOK_VALIDATE: z.string().optional(),
  ARTIFACTS_DIR: z.string().min(1),
  NOTIFY_PROVIDER_EMAIL: z.enum(['noop', 'mailgun', 'sendgrid']).default('noop'),
  NOTIFY_PROVIDER_WHATSAPP: z.enum(['noop', 'twilio']).default('noop'),
  MAILGUN_API_KEY: z.string().optional(),
  MAILGUN_DOMAIN: z.string().optional(),
  MAILGUN_FROM: z.string().optional(),
  MAILGUN_WEBHOOK_SIGNING_KEY: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default('zenops-dev'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.string().default('false'),
  S3_PUBLIC_BASE_URL: z.string().optional()
});

export type AppEnv = z.infer<typeof EnvSchema>;

export const loadEnv = (input: Record<string, string | undefined> = process.env): AppEnv => {
  return EnvSchema.parse(input);
};
