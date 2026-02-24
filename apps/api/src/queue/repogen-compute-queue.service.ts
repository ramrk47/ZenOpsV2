import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';

export const REPOGEN_COMPUTE_SNAPSHOT_QUEUE = 'repogen-compute-snapshot';

export interface RepogenComputeSnapshotQueuePayload {
  workOrderId: string;
  snapshotVersion: number;
  tenantId: string;
  requestId: string;
}

@Injectable()
export class RepogenComputeSnapshotQueueService implements OnModuleDestroy {
  private readonly queue: Queue<RepogenComputeSnapshotQueuePayload> | null;

  constructor(redisUrl: string, disabled = false) {
    this.queue = disabled
      ? null
      : new Queue<RepogenComputeSnapshotQueuePayload>(REPOGEN_COMPUTE_SNAPSHOT_QUEUE, {
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

  async enqueueSnapshotCompute(payload: RepogenComputeSnapshotQueuePayload): Promise<void> {
    if (!this.queue) {
      return;
    }

    await this.queue.add('repogen_compute_snapshot', payload, {
      jobId: `${payload.workOrderId}:${payload.snapshotVersion}`
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
    }
  }
}
