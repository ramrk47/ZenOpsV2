import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';

export const NOTIFICATIONS_QUEUE = 'notifications';

export interface NotificationQueuePayload {
  outboxId: string;
  tenantId: string;
  requestId: string;
}

@Injectable()
export class NotificationQueueService implements OnModuleDestroy {
  private readonly queue: Queue<NotificationQueuePayload> | null;

  constructor(redisUrl: string, disabled = false) {
    this.queue = disabled
      ? null
      : new Queue<NotificationQueuePayload>(NOTIFICATIONS_QUEUE, {
          connection: { url: redisUrl },
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
  }

  async enqueue(payload: NotificationQueuePayload): Promise<void> {
    if (!this.queue) {
      return;
    }
    await this.queue.add('send', payload, {
      jobId: payload.outboxId
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
    }
  }
}
