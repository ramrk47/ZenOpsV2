import type { Logger } from '@zenops/common';
import { withTxContext, type PrismaClient } from '@zenops/db';

export const TASK_OVERDUE_QUEUE = 'task-overdue';

export interface RecomputeOverduePayload {
  tenantId: string;
  requestId: string;
}

export interface ProcessTaskOverdueJobParams {
  prisma: PrismaClient;
  logger: Logger;
  payload: RecomputeOverduePayload;
  fallbackTenantId: string;
  runWithContext?: <T>(
    prisma: PrismaClient,
    context: { tenantId: string; userId: string | null; aud: 'worker' },
    fn: (tx: any) => Promise<T>
  ) => Promise<T>;
}

export const processTaskOverdueJob = async ({
  prisma,
  logger,
  payload,
  fallbackTenantId,
  runWithContext = withTxContext
}: ProcessTaskOverdueJobParams): Promise<void> => {
  const tenantId = payload.tenantId || fallbackTenantId;
  const now = new Date();

  await runWithContext(prisma, { tenantId, userId: null, aud: 'worker' }, async (tx) => {
    const overdue = await tx.task.updateMany({
      where: {
        tenantId,
        deletedAt: null,
        status: {
          not: 'done'
        },
        dueAt: {
          lt: now
        },
        isOverdue: false
      },
      data: {
        isOverdue: true
      }
    });

    const cleared = await tx.task.updateMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [
          {
            status: 'done'
          },
          {
            dueAt: null
          },
          {
            dueAt: {
              gte: now
            }
          }
        ],
        isOverdue: true
      },
      data: {
        isOverdue: false
      }
    });

    logger.info('task_overdue_recompute', {
      tenant_id: tenantId,
      request_id: payload.requestId,
      set_overdue: overdue.count,
      cleared_overdue: cleared.count
    });
  });
};
