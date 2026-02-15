import { Queue, Worker } from 'bullmq';
import { createJsonLogger } from '@zenops/common';
import { loadEnv } from '@zenops/config';
import { createPrismaClient } from '@zenops/db';
import { processDraftJob, type QueueDraftPayload } from './processor.js';
import { NOTIFICATIONS_QUEUE, processNotificationJob, type NotificationQueuePayload } from './notifications.processor.js';
import {
  ASSIGNMENT_SIGNALS_QUEUE,
  processAssignmentSignalsJob,
  type RecomputeAssignmentSignalsPayload
} from './assignment-signals.processor.js';
import {
  TASK_OVERDUE_QUEUE,
  processTaskOverdueJob,
  type RecomputeOverduePayload
} from './task-overdue.processor.js';

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

const taskOverdueQueue = new Queue<RecomputeOverduePayload>(TASK_OVERDUE_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: {
      count: 1000
    },
    removeOnFail: {
      count: 1000,
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

const assignmentSignalsWorker = new Worker<RecomputeAssignmentSignalsPayload>(
  ASSIGNMENT_SIGNALS_QUEUE,
  async (job) => {
    await processAssignmentSignalsJob({
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

const taskOverdueWorker = new Worker<RecomputeOverduePayload>(
  TASK_OVERDUE_QUEUE,
  async (job) => {
    await processTaskOverdueJob({
      prisma,
      logger,
      payload: job.data,
      fallbackTenantId: defaultTenantId
    });
  },
  {
    connection: redisConnection,
    concurrency: Math.max(1, Math.min(2, concurrency))
  }
);

const ensureRecurringOverdueJobs = async () => {
  const internalJobId = `recompute_overdue:${defaultTenantId}`;
  await taskOverdueQueue.add(
    'recompute_overdue',
    {
      tenantId: defaultTenantId,
      requestId: 'scheduler'
    },
    {
      jobId: internalJobId,
      repeat: {
        every: 10 * 60 * 1000
      }
    }
  );

  const externalTenantId = process.env.ZENOPS_EXTERNAL_TENANT_ID;
  if (externalTenantId && externalTenantId !== defaultTenantId) {
    await taskOverdueQueue.add(
      'recompute_overdue',
      {
        tenantId: externalTenantId,
        requestId: 'scheduler'
      },
      {
        jobId: `recompute_overdue:${externalTenantId}`,
        repeat: {
          every: 10 * 60 * 1000
        }
      }
    );
  }
};

void ensureRecurringOverdueJobs().catch((error) => {
  logger.error('task_overdue_schedule_failed', {
    error: error instanceof Error ? error.message : 'unknown'
  });
});

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

assignmentSignalsWorker.on('ready', () => {
  logger.info('worker_ready', {
    queue: ASSIGNMENT_SIGNALS_QUEUE,
    concurrency
  });
});

taskOverdueWorker.on('ready', () => {
  logger.info('worker_ready', {
    queue: TASK_OVERDUE_QUEUE,
    concurrency: Math.max(1, Math.min(2, concurrency))
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

assignmentSignalsWorker.on('error', (error) => {
  logger.error('worker_error', {
    queue: ASSIGNMENT_SIGNALS_QUEUE,
    error: error.message
  });
});

taskOverdueWorker.on('error', (error) => {
  logger.error('worker_error', {
    queue: TASK_OVERDUE_QUEUE,
    error: error.message
  });
});

const shutdown = async () => {
  logger.info('worker_shutdown');
  await worker.close();
  await notificationsWorker.close();
  await assignmentSignalsWorker.close();
  await taskOverdueWorker.close();
  await notificationsQueue.close();
  await taskOverdueQueue.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});
