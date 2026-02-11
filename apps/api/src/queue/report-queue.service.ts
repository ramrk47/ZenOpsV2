import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';

export const REPORT_GENERATION_QUEUE = 'report-generation';

export interface QueueDraftPayload {
  reportRequestId: string;
  reportJobId: string;
  tenantId: string;
  requestId: string;
}

@Injectable()
export class ReportQueueService implements OnModuleDestroy {
  private readonly queue: Queue<QueueDraftPayload> | null;

  constructor(redisUrl: string, disabled = false) {
    this.queue = disabled
      ? null
      : new Queue<QueueDraftPayload>(REPORT_GENERATION_QUEUE, {
          connection: { url: redisUrl },
          defaultJobOptions: {
            attempts: 5,
            backoff: {
              type: 'exponential',
              delay: 2000
            },
            removeOnComplete: {
              count: 1000
            },
            removeOnFail: {
              count: 1000,
              age: 60 * 60 * 24 * 7
            }
          }
        });
  }

  async enqueueDraft(payload: QueueDraftPayload): Promise<void> {
    if (!this.queue) {
      return;
    }
    await this.queue.add('draft', payload, {
      jobId: payload.reportJobId
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
    }
  }
}
