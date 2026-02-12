import { Queue, Worker } from 'bullmq';
import { createJsonLogger } from '@zenops/common';
import { loadEnv } from '@zenops/config';
import { createPrismaClient } from '@zenops/db';
import { processDraftJob, type QueueDraftPayload } from './processor.js';
import { NOTIFICATIONS_QUEUE, processNotificationJob, type NotificationQueuePayload } from './notifications.processor.js';

const REPORT_GENERATION_QUEUE = 'report-generation';

const env = loadEnv();
const logger = createJsonLogger();
const prisma = createPrismaClient(env.DATABASE_URL_WORKER);

const artifactsRoot = process.env.ARTIFACTS_DIR ?? env.ARTIFACTS_DIR;
const defaultTenantId =
  process.env.ZENOPS_INTERNAL_TENANT_ID ?? process.env.TENANT_INTERNAL_UUID ?? env.ZENOPS_INTERNAL_TENANT_ID;
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? env.WORKER_CONCURRENCY);
const redisConnection = { url: process.env.REDIS_URL ?? env.REDIS_URL };

const notificationsQueue = new Queue<NotificationQueuePayload>(NOTIFICATIONS_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: {
      count: 2000
    },
    removeOnFail: {
      count: 5000,
      age: 60 * 60 * 24
    }
  }
});

const worker = new Worker<QueueDraftPayload>(
  REPORT_GENERATION_QUEUE,
  async (job) => {
    await processDraftJob({
      prisma,
      logger,
      payload: job.data,
      artifactsRoot,
      fallbackTenantId: defaultTenantId,
      enqueueNotification: async (notificationPayload) => {
        await notificationsQueue.add('send', notificationPayload, {
          jobId: notificationPayload.outboxId
        });
      }
    });
  },
  {
    connection: redisConnection,
    concurrency
  }
);

const notificationsWorker = new Worker<NotificationQueuePayload>(
  NOTIFICATIONS_QUEUE,
  async (job) => {
    await processNotificationJob({
      prisma,
      logger,
      payload: job.data,
      fallbackTenantId: defaultTenantId
    });
  },
  {
    connection: redisConnection,
    concurrency
  }
);

worker.on('ready', () => {
  logger.info('worker_ready', {
    queue: REPORT_GENERATION_QUEUE,
    concurrency
  });
});

notificationsWorker.on('ready', () => {
  logger.info('worker_ready', {
    queue: NOTIFICATIONS_QUEUE,
    concurrency
  });
});

worker.on('error', (error) => {
  logger.error('worker_error', {
    queue: REPORT_GENERATION_QUEUE,
    error: error.message
  });
});

notificationsWorker.on('error', (error) => {
  logger.error('worker_error', {
    queue: NOTIFICATIONS_QUEUE,
    error: error.message
  });
});

const shutdown = async () => {
  logger.info('worker_shutdown');
  await worker.close();
  await notificationsWorker.close();
  await notificationsQueue.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});
