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

export interface NotificationEnqueuePayload {
  outboxId: string;
  tenantId: string;
  requestId: string;
}

export interface ProcessDraftParams {
  prisma: PrismaClient;
  logger: Logger;
  payload: QueueDraftPayload;
  artifactsRoot: string;
  fallbackTenantId: string;
  notifyInternalEmail?: string;
  enqueueNotification?: (payload: NotificationEnqueuePayload) => Promise<void>;
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
  notifyInternalEmail,
  enqueueNotification,
  runWithContext = withTxContext
}: ProcessDraftParams): Promise<void> => {
  const tenantId = payload.tenantId || fallbackTenantId;
  let draftReadyOutboxId: string | null = null;

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

      const reportRequest = await tx.reportRequest.findFirst({
        where: {
          id: payload.reportRequestId,
          deletedAt: null
        },
        select: {
          id: true,
          assignmentId: true,
          workOrderId: true
        }
      });

      if (!reportRequest) {
        throw new Error(`report_request ${payload.reportRequestId} not found`);
      }

      const reportInput = await tx.reportInput.findUnique({
        where: {
          reportRequestId: payload.reportRequestId
        },
        select: {
          schemaId: true,
          payload: true
        }
      });

      const linkScope: Array<{ reportRequestId?: string; assignmentId?: string; workOrderId?: string }> = [
        { reportRequestId: payload.reportRequestId }
      ];
      if (reportRequest.assignmentId) {
        linkScope.push({ assignmentId: reportRequest.assignmentId });
      }
      if (reportRequest.workOrderId) {
        linkScope.push({ workOrderId: reportRequest.workOrderId });
      }

      const linkedDocuments = await tx.documentLink.findMany({
        where: {
          tenantId,
          OR: linkScope
        },
        include: {
          document: {
            select: {
              id: true,
              storageKey: true,
              originalFilename: true,
              contentType: true,
              sizeBytes: true,
              status: true
            }
          }
        }
      });

      logger.info('worker_data_bundle_loaded', {
        request_id: payload.requestId,
        report_request_id: payload.reportRequestId,
        report_job_id: payload.reportJobId,
        has_report_input: Boolean(reportInput),
        linked_documents: linkedDocuments.length
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

      const outboxIdempotencyKey = `draft_ready:${payload.reportRequestId}`;
      const existingOutbox = await tx.notificationOutbox.findFirst({
        where: {
          tenantId,
          idempotencyKey: outboxIdempotencyKey
        },
        select: { id: true }
      });

      if (existingOutbox) {
        draftReadyOutboxId = existingOutbox.id;
        return;
      }

      const fallbackEmail = notifyInternalEmail ?? process.env.NOTIFY_INTERNAL_EMAIL ?? 'internal-admin@zenops.local';
      let contactPoint = await tx.contactPoint.findFirst({
        where: {
          tenantId,
          kind: 'email',
          value: fallbackEmail
        },
        select: { id: true }
      });

      if (!contactPoint) {
        contactPoint = await tx.contactPoint.create({
          data: {
            tenantId,
            kind: 'email',
            value: fallbackEmail,
            isPrimary: true,
            isVerified: false
          },
          select: { id: true }
        });
      }

      const template = await tx.notificationTemplate.findFirst({
        where: {
          tenantId,
          channel: 'email',
          templateKey: 'report_draft_ready',
          isActive: true
        },
        select: { provider: true }
      });

      const outbox = await tx.notificationOutbox.create({
        data: {
          tenantId,
          toContactPointId: contactPoint.id,
          channel: 'email',
          provider: template?.provider ?? 'noop',
          templateKey: 'report_draft_ready',
          payloadJson: {
            report_request_id: payload.reportRequestId,
            report_job_id: payload.reportJobId
          },
          status: 'queued',
          idempotencyKey: outboxIdempotencyKey,
          assignmentId: reportRequest.assignmentId,
          reportRequestId: payload.reportRequestId
        },
        select: { id: true }
      });

      draftReadyOutboxId = outbox.id;
    });

    if (draftReadyOutboxId && enqueueNotification) {
      try {
        await enqueueNotification({
          outboxId: draftReadyOutboxId,
          tenantId,
          requestId: payload.requestId
        });
      } catch (queueError) {
        logger.error('worker_notification_enqueue_failed', {
          request_id: payload.requestId,
          report_request_id: payload.reportRequestId,
          report_job_id: payload.reportJobId,
          outbox_id: draftReadyOutboxId,
          error: queueError instanceof Error ? queueError.message : 'unknown'
        });
      }
    }

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
