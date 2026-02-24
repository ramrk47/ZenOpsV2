import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';

export const REPOGEN_GENERATION_QUEUE = 'repogen-generation';

export interface RepogenQueuePayload {
  reportGenerationJobId: string;
  assignmentId: string;
  tenantId: string;
  requestId: string;
}

@Injectable()
export class RepogenQueueService implements OnModuleDestroy {
  private readonly queue: Queue<RepogenQueuePayload> | null;

  constructor(redisUrl: string, disabled = false) {
    this.queue = disabled
      ? null
      : new Queue<RepogenQueuePayload>(REPOGEN_GENERATION_QUEUE, {
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

  async enqueueGeneration(payload: RepogenQueuePayload): Promise<void> {
    if (!this.queue) {
      return;
    }
    await this.queue.add('generate', payload, {
      jobId: payload.reportGenerationJobId
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
    }
  }
}
