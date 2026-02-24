import type { Logger } from '@zenops/common';
import { withTxContext, type PrismaClient } from '@zenops/db';

export const REPOGEN_COMPUTE_SNAPSHOT_QUEUE = 'repogen-compute-snapshot';

export interface RepogenComputeSnapshotQueuePayload {
  workOrderId: string;
  snapshotVersion: number;
  tenantId: string;
  requestId: string;
}

export interface ProcessRepogenComputeSnapshotJobParams {
  prisma: PrismaClient;
  logger: Logger;
  payload: RepogenComputeSnapshotQueuePayload;
  fallbackTenantId: string;
  runWithContext?: <T>(
    prisma: PrismaClient,
    context: { tenantId: string; userId: string | null; aud: 'worker' },
    fn: (tx: any) => Promise<T>
  ) => Promise<T>;
}

export const processRepogenComputeSnapshotJob = async ({
  prisma,
  logger,
  payload,
  fallbackTenantId,
  runWithContext = withTxContext
}: ProcessRepogenComputeSnapshotJobParams): Promise<void> => {
  const tenantId = payload.tenantId || fallbackTenantId;

  await runWithContext(prisma, { tenantId, userId: null, aud: 'worker' }, async (tx) => {
    const workOrder = await tx.repogenWorkOrder.findFirst({
      where: {
        id: payload.workOrderId
      },
      select: {
        id: true,
        status: true,
        reportType: true,
        bankType: true,
        valueSlab: true,
        templateSelector: true
      }
    });

    if (!workOrder) {
      throw new Error(`repogen_work_order ${payload.workOrderId} not found`);
    }

    const snapshot = await tx.repogenContractSnapshot.findFirst({
      where: {
        workOrderId: payload.workOrderId,
        version: payload.snapshotVersion
      },
      select: {
        id: true,
        version: true,
        createdAt: true
      }
    });

    if (!snapshot) {
      throw new Error(`repogen_contract_snapshot ${payload.workOrderId}:${payload.snapshotVersion} not found`);
    }

    // Placeholder worker hook for M5.4: validates idempotent job routing and snapshot visibility.
    logger.info('repogen_compute_snapshot_placeholder_processed', {
      request_id: payload.requestId,
      tenant_id: tenantId,
      work_order_id: workOrder.id,
      snapshot_version: snapshot.version,
      status: workOrder.status,
      report_type: workOrder.reportType,
      bank_type: workOrder.bankType,
      value_slab: workOrder.valueSlab,
      template_selector: workOrder.templateSelector,
      snapshot_created_at: snapshot.createdAt.toISOString()
    });
  });
};
