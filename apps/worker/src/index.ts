import { Worker } from 'bullmq';
import { createJsonLogger } from '@zenops/common';
import { loadEnv } from '@zenops/config';
import { createPrismaClient } from '@zenops/db';
import { processDraftJob, type QueueDraftPayload } from './processor.js';

const REPORT_GENERATION_QUEUE = 'report-generation';

const env = loadEnv();
const logger = createJsonLogger();
const prisma = createPrismaClient(env.DATABASE_URL_WORKER);

const artifactsRoot = process.env.ARTIFACTS_DIR ?? env.ARTIFACTS_DIR;
const defaultTenantId = process.env.TENANT_INTERNAL_UUID ?? env.TENANT_INTERNAL_UUID;
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? env.WORKER_CONCURRENCY);

const worker = new Worker<QueueDraftPayload>(
  REPORT_GENERATION_QUEUE,
  async (job) => {
    await processDraftJob({
      prisma,
      logger,
      payload: job.data,
      artifactsRoot,
      fallbackTenantId: defaultTenantId
    });
  },
  {
    connection: { url: process.env.REDIS_URL ?? env.REDIS_URL },
    concurrency
  }
);

worker.on('ready', () => {
  logger.info('worker_ready', {
    queue: REPORT_GENERATION_QUEUE,
    concurrency
  });
});

worker.on('error', (error) => {
  logger.error('worker_error', {
    error: error.message
  });
});

const shutdown = async () => {
  logger.info('worker_shutdown');
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});
