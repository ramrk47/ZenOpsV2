import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';

export const ASSIGNMENT_SIGNALS_QUEUE = 'assignment-signals';

export interface RecomputeAssignmentSignalsPayload {
  assignmentId: string;
  tenantId: string;
  stage: string;
  dateBucket: string;
  requestId: string;
}

@Injectable()
export class AssignmentSignalsQueueService implements OnModuleDestroy {
  private readonly queue: Queue<RecomputeAssignmentSignalsPayload> | null;

  constructor(redisUrl: string, disabled = false) {
    this.queue = disabled
      ? null
      : new Queue<RecomputeAssignmentSignalsPayload>(ASSIGNMENT_SIGNALS_QUEUE, {
          connection: { url: redisUrl },
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
              count: 2000,
              age: 60 * 60 * 24 * 7
            }
          }
        });
  }

  async enqueueRecompute(payload: RecomputeAssignmentSignalsPayload): Promise<void> {
    if (!this.queue) {
      return;
    }
    await this.queue.add('recompute', payload, {
      jobId: `recompute_assignment_signals:${payload.assignmentId}:${payload.stage}:${payload.dateBucket}`
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
    }
  }
}
