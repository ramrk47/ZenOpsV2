import type { Logger } from '@zenops/common';
import { withTxContext, type PrismaClient } from '@zenops/db';

const SIGNAL_KINDS = ['overdue', 'stuck_in_qc', 'billing_pending'] as const;
type SignalKind = (typeof SIGNAL_KINDS)[number];
export const ASSIGNMENT_SIGNALS_QUEUE = 'assignment-signals';

export interface RecomputeAssignmentSignalsPayload {
  assignmentId: string;
  tenantId: string;
  stage: string;
  dateBucket: string;
  requestId: string;
}

export interface ProcessAssignmentSignalsJobParams {
  prisma: PrismaClient;
  logger: Logger;
  payload: RecomputeAssignmentSignalsPayload;
  fallbackTenantId: string;
  runWithContext?: <T>(
    prisma: PrismaClient,
    context: { tenantId: string; userId: string | null; aud: 'worker' },
    fn: (tx: any) => Promise<T>
  ) => Promise<T>;
}

export const processAssignmentSignalsJob = async ({
  prisma,
  logger,
  payload,
  fallbackTenantId,
  runWithContext = withTxContext
}: ProcessAssignmentSignalsJobParams): Promise<void> => {
  const tenantId = payload.tenantId || fallbackTenantId;
  const now = new Date();
  const stuckThresholdHours = Number(process.env.ASSIGNMENT_STUCK_QC_HOURS ?? '24');
  const billingThresholdDays = Number(process.env.ASSIGNMENT_BILLING_PENDING_DAYS ?? '3');

  await runWithContext(prisma, { tenantId, userId: null, aud: 'worker' }, async (tx) => {
    const assignment = await tx.assignment.findFirst({
      where: {
        id: payload.assignmentId,
        tenantId,
        deletedAt: null
      },
      select: {
        id: true,
        tenantId: true,
        stage: true,
        dueDate: true
      }
    });

    if (!assignment) {
      logger.info('assignment_signals_assignment_missing', {
        request_id: payload.requestId,
        assignment_id: payload.assignmentId,
        tenant_id: tenantId
      });
      return;
    }

    const [qcTransition, sentTransition, existingSignals] = await Promise.all([
      tx.assignmentStageTransition.findFirst({
        where: {
          tenantId,
          assignmentId: assignment.id,
          toStage: 'qc_pending'
        },
        orderBy: { changedAt: 'desc' },
        select: {
          changedAt: true
        }
      }),
      tx.assignmentStageTransition.findFirst({
        where: {
          tenantId,
          assignmentId: assignment.id,
          toStage: 'sent_to_client'
        },
        orderBy: { changedAt: 'desc' },
        select: {
          changedAt: true
        }
      }),
      tx.assignmentSignal.findMany({
        where: {
          tenantId,
          assignmentId: assignment.id
        }
      })
    ]);

    type ExistingSignal = { id: string; isActive: boolean };
    const existingByKind = new Map<SignalKind, ExistingSignal>(
      existingSignals.map((row: any) => [
        row.kind as SignalKind,
        {
          id: String(row.id),
          isActive: Boolean(row.isActive)
        }
      ])
    );
    const overdue = Boolean(assignment.dueDate && assignment.dueDate.getTime() < now.getTime() && assignment.stage !== 'closed');
    const stuckInQc =
      assignment.stage === 'qc_pending' &&
      Boolean(
        qcTransition &&
          now.getTime() - qcTransition.changedAt.getTime() >= stuckThresholdHours * 60 * 60 * 1000
      );
    const billingPending =
      assignment.stage === 'sent_to_client' &&
      Boolean(
        sentTransition &&
          now.getTime() - sentTransition.changedAt.getTime() >= billingThresholdDays * 24 * 60 * 60 * 1000
      );

    const activeByKind: Record<SignalKind, boolean> = {
      overdue,
      stuck_in_qc: stuckInQc,
      billing_pending: billingPending
    };

    for (const kind of SIGNAL_KINDS) {
      const isActive = activeByKind[kind];
      const existing = existingByKind.get(kind);
      const detailsJson = {
        evaluated_at: now.toISOString(),
        stage: assignment.stage,
        due_date: assignment.dueDate?.toISOString() ?? null,
        stuck_threshold_hours: stuckThresholdHours,
        billing_pending_days: billingThresholdDays
      };

      if (isActive) {
        if (existing) {
          await tx.assignmentSignal.update({
            where: { id: existing.id },
            data: {
              isActive: true,
              lastSeenAt: now,
              detailsJson
            }
          });
        } else {
          await tx.assignmentSignal.create({
            data: {
              tenantId,
              assignmentId: assignment.id,
              kind,
              isActive: true,
              firstSeenAt: now,
              lastSeenAt: now,
              detailsJson
            }
          });
        }
      } else if (existing?.isActive) {
        await tx.assignmentSignal.update({
          where: { id: existing.id },
          data: {
            isActive: false,
            lastSeenAt: now,
            detailsJson
          }
        });
      }
    }
  });
};
