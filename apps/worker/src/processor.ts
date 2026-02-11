import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Logger } from '@zenops/common';
import { withTxContext, type PrismaClient } from '@zenops/db';

export interface QueueDraftPayload {
  reportRequestId: string;
  reportJobId: string;
  tenantId: string;
  requestId: string;
}

export interface ProcessDraftParams {
  prisma: PrismaClient;
  logger: Logger;
  payload: QueueDraftPayload;
  artifactsRoot: string;
  fallbackTenantId: string;
  runWithContext?: <T>(
    prisma: PrismaClient,
    context: { tenantId: string; userId: string | null; aud: 'worker' },
    fn: (tx: any) => Promise<T>
  ) => Promise<T>;
}

export const processDraftJob = async ({
  prisma,
  logger,
  payload,
  artifactsRoot,
  fallbackTenantId,
  runWithContext = withTxContext
}: ProcessDraftParams): Promise<void> => {
  const tenantId = payload.tenantId || fallbackTenantId;

  logger.info('worker_job_start', {
    request_id: payload.requestId,
    report_request_id: payload.reportRequestId,
    report_job_id: payload.reportJobId,
    tenant_id: tenantId
  });

  try {
    await runWithContext(prisma, { tenantId, userId: null, aud: 'worker' }, async (tx) => {
      await tx.reportJob.update({
        where: { id: payload.reportJobId },
        data: {
          status: 'processing',
          startedAt: new Date(),
          attempts: { increment: 1 }
        }
      });

      let artifact = await tx.reportArtifact.findFirst({
        where: {
          reportRequestId: payload.reportRequestId,
          kind: 'draft_docx',
          deletedAt: null
        }
      });

      if (!artifact) {
        artifact = await tx.reportArtifact.create({
          data: {
            tenantId,
            reportRequestId: payload.reportRequestId,
            kind: 'draft_docx'
          }
        });
      }

      const latest = await tx.artifactVersion.findFirst({
        where: {
          reportArtifactId: artifact.id,
          deletedAt: null
        },
        orderBy: { version: 'desc' }
      });

      const nextVersion = (latest?.version ?? 0) + 1;
      const artifactPath = join(artifactsRoot, payload.reportRequestId, `${payload.reportJobId}-v${nextVersion}.docx`);
      await mkdir(dirname(artifactPath), { recursive: true });
      await writeFile(artifactPath, `Placeholder DOCX for request ${payload.reportRequestId}\n`);

      await tx.artifactVersion.create({
        data: {
          tenantId,
          reportArtifactId: artifact.id,
          version: nextVersion,
          path: artifactPath,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          sizeBytes: 128
        }
      });

      await tx.reportJob.update({
        where: { id: payload.reportJobId },
        data: {
          status: 'succeeded',
          finishedAt: new Date()
        }
      });

      await tx.reportRequest.update({
        where: { id: payload.reportRequestId },
        data: {
          status: 'draft_ready'
        }
      });
    });

    logger.info('worker_job_succeeded', {
      request_id: payload.requestId,
      report_request_id: payload.reportRequestId,
      report_job_id: payload.reportJobId
    });
  } catch (error) {
    logger.error('worker_job_failed', {
      request_id: payload.requestId,
      report_request_id: payload.reportRequestId,
      report_job_id: payload.reportJobId,
      error: error instanceof Error ? error.message : 'unknown'
    });

    await runWithContext(prisma, { tenantId, userId: null, aud: 'worker' }, async (tx) => {
      await tx.reportJob.update({
        where: { id: payload.reportJobId },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : 'unknown'
        }
      });

      await tx.reportRequest.update({
        where: { id: payload.reportRequestId },
        data: {
          status: 'failed'
        }
      });

      const reservation = await tx.creditsLedger.findFirst({
        where: {
          reportRequestId: payload.reportRequestId,
          status: 'reserved',
          deletedAt: null
        },
        orderBy: { createdAt: 'desc' }
      });

      if (reservation) {
        await tx.creditsLedger.update({
          where: { id: reservation.id },
          data: {
            status: 'released',
            idempotencyKey: `release:${payload.reportRequestId}:worker-failure`
          }
        });
      }
    });

    throw error;
  }
};
