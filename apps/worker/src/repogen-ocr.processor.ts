import type { Logger } from '@zenops/common';
import { Prisma, withTxContext, type PrismaClient } from '@zenops/db';

export const REPOGEN_OCR_QUEUE = 'repogen-ocr-placeholder';

export interface RepogenOcrQueuePayload {
  ocrJobId: string;
  workOrderId: string;
  evidenceItemId: string;
  tenantId: string;
  requestId: string;
}

export interface ProcessRepogenOcrJobParams {
  prisma: PrismaClient;
  logger: Logger;
  payload: RepogenOcrQueuePayload;
  fallbackTenantId: string;
  runWithContext?: <T>(
    prisma: PrismaClient,
    context: { tenantId: string; userId: string | null; aud: 'worker' },
    fn: (tx: any) => Promise<T>
  ) => Promise<T>;
}

const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export const processRepogenOcrPlaceholderJob = async ({
  prisma,
  logger,
  payload,
  fallbackTenantId,
  runWithContext = withTxContext
}: ProcessRepogenOcrJobParams): Promise<void> => {
  const tenantId = payload.tenantId || fallbackTenantId;

  await runWithContext(prisma, { tenantId, userId: null, aud: 'worker' }, async (tx) => {
    const job = await tx.repogenOcrJob.findFirst({
      where: {
        id: payload.ocrJobId,
        workOrderId: payload.workOrderId,
        evidenceItemId: payload.evidenceItemId
      },
      select: {
        id: true,
        status: true,
        workOrderId: true,
        evidenceItemId: true,
        resultJson: true,
        requestedAt: true
      }
    });

    if (!job) {
      throw new Error(`repogen_ocr_job ${payload.ocrJobId} not found`);
    }

    if (job.status === 'DONE') {
      logger.info('repogen_ocr_placeholder_idempotent_skip', {
        request_id: payload.requestId,
        tenant_id: tenantId,
        ocr_job_id: job.id,
        work_order_id: job.workOrderId,
        evidence_item_id: job.evidenceItemId
      });
      return;
    }

    const now = new Date();
    const resultJson = {
      extracted_text: '',
      detected_fields: [],
      note: 'OCR not enabled yet',
      placeholder: true,
      request_id: payload.requestId,
      processed_at: now.toISOString()
    };

    await tx.repogenOcrJob.update({
      where: { id: job.id },
      data: {
        status: 'DONE',
        finishedAt: now,
        resultJson: asJson(resultJson),
        error: null,
        workerTrace: payload.requestId
      }
    });

    logger.info('repogen_ocr_placeholder_done', {
      request_id: payload.requestId,
      tenant_id: tenantId,
      ocr_job_id: job.id,
      work_order_id: job.workOrderId,
      evidence_item_id: job.evidenceItemId,
      requested_at: job.requestedAt.toISOString(),
      finished_at: now.toISOString()
    });
  });
};
