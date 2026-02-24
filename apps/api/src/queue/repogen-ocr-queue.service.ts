import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';

export const REPOGEN_OCR_QUEUE = 'repogen-ocr-placeholder';

export interface RepogenOcrQueuePayload {
  ocrJobId: string;
  workOrderId: string;
  evidenceItemId: string;
  tenantId: string;
  requestId: string;
}

@Injectable()
export class RepogenOcrQueueService implements OnModuleDestroy {
  private readonly queue: Queue<RepogenOcrQueuePayload> | null;

  constructor(redisUrl: string, disabled = false) {
    this.queue = disabled
      ? null
      : new Queue<RepogenOcrQueuePayload>(REPOGEN_OCR_QUEUE, {
          connection: { url: redisUrl },
          defaultJobOptions: {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 1000
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

  async enqueue(payload: RepogenOcrQueuePayload): Promise<void> {
    if (!this.queue) {
      return;
    }

    await this.queue.add('repogen_ocr_placeholder', payload, {
      jobId: payload.ocrJobId
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
    }
  }
}
