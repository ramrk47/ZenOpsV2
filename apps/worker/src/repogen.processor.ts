import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Logger } from '@zenops/common';
import { withTxContext, type PrismaClient } from '@zenops/db';

export const REPOGEN_GENERATION_QUEUE = 'repogen-generation';

export interface RepogenQueuePayload {
  reportGenerationJobId: string;
  assignmentId: string;
  tenantId: string;
  requestId: string;
}

export interface ProcessRepogenJobParams {
  prisma: PrismaClient;
  logger: Logger;
  payload: RepogenQueuePayload;
  artifactsRoot: string;
  fallbackTenantId: string;
  runWithContext?: <T>(
    prisma: PrismaClient,
    context: { tenantId: string; userId: string | null; aud: 'worker' },
    fn: (tx: any) => Promise<T>
  ) => Promise<T>;
}

export const processRepogenGenerationJob = async ({
  prisma,
  logger,
  payload,
  artifactsRoot,
  fallbackTenantId,
  runWithContext = withTxContext
}: ProcessRepogenJobParams): Promise<void> => {
  const tenantId = payload.tenantId || fallbackTenantId;

  logger.info('repogen_job_start', {
    request_id: payload.requestId,
    repogen_job_id: payload.reportGenerationJobId,
    assignment_id: payload.assignmentId,
    tenant_id: tenantId
  });

  try {
    await runWithContext(prisma, { tenantId, userId: null, aud: 'worker' }, async (tx) => {
      const job = await tx.reportGenerationJob.findFirst({
        where: {
          id: payload.reportGenerationJobId,
          tenantId
        },
        include: {
          reportPack: {
            include: {
              artifacts: true
            }
          }
        }
      });

      if (!job) {
        throw new Error(`report_generation_job ${payload.reportGenerationJobId} not found`);
      }

      if (job.assignmentId !== payload.assignmentId) {
        throw new Error(`assignment mismatch for job ${payload.reportGenerationJobId}`);
      }

      if (job.status === 'completed' && job.reportPackId && job.reportPack) {
        logger.info('repogen_job_idempotent_skip', {
          request_id: payload.requestId,
          repogen_job_id: payload.reportGenerationJobId,
          report_pack_id: job.reportPackId
        });
        return;
      }

      await tx.reportGenerationJob.update({
        where: { id: job.id },
        data: {
          status: 'processing',
          startedAt: job.startedAt ?? new Date(),
          attempts: { increment: 1 },
          workerTrace: payload.requestId,
          errorMessage: null
        }
      });

      const assignment = await tx.assignment.findFirst({
        where: {
          id: job.assignmentId,
          tenantId,
          deletedAt: null
        },
        select: {
          id: true,
          title: true
        }
      });

      if (!assignment) {
        throw new Error(`assignment ${job.assignmentId} not found`);
      }

      const [fieldValues, evidenceLinks] = await Promise.all([
        tx.reportFieldValue.findMany({
          where: {
            tenantId,
            assignmentId: job.assignmentId,
            templateKey: job.templateKey
          },
          orderBy: [{ sectionKey: 'asc' }, { fieldKey: 'asc' }]
        }),
        tx.reportEvidenceLink.findMany({
          where: {
            tenantId,
            assignmentId: job.assignmentId,
            templateKey: job.templateKey
          },
          include: {
            document: {
              select: {
                id: true,
                originalFilename: true,
                contentType: true
              }
            }
          },
          orderBy: [{ sectionKey: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }]
        })
      ]);

      let reportPackId = job.reportPackId;
      let packVersion = 1;

      if (reportPackId) {
        const existingPack = await tx.reportPack.findFirst({
          where: { id: reportPackId, tenantId },
          select: { id: true, version: true }
        });
        if (!existingPack) {
          reportPackId = null;
        } else {
          packVersion = existingPack.version;
        }
      }

      if (!reportPackId) {
        const latestPack = await tx.reportPack.findFirst({
          where: {
            tenantId,
            assignmentId: job.assignmentId,
            templateKey: job.templateKey
          },
          orderBy: { version: 'desc' },
          select: {
            id: true,
            version: true
          }
        });

        packVersion = (latestPack?.version ?? 0) + 1;

        const pack = await tx.reportPack.create({
          data: {
            tenantId,
            assignmentId: job.assignmentId,
            templateVersionId: job.templateVersionId,
            templateKey: job.templateKey,
            reportFamily: job.reportFamily,
            version: packVersion,
            status: 'generating',
            createdByUserId: job.requestedByUserId,
            warningsJson: job.warningsJson,
            contextSnapshotJson: {
              assignment: {
                id: assignment.id,
                title: assignment.title
              },
              field_count: fieldValues.length,
              evidence_count: evidenceLinks.length
            }
          },
          select: { id: true, version: true }
        });

        reportPackId = pack.id;
        packVersion = pack.version;

        await tx.reportGenerationJob.update({
          where: { id: job.id },
          data: {
            reportPackId: reportPackId
          }
        });
      }

      const existingDocxArtifact = await tx.reportPackArtifact.findFirst({
        where: {
          tenantId,
          reportPackId,
          kind: 'docx'
        },
        select: { id: true }
      });

      if (!existingDocxArtifact) {
        const artifactPath = join(
          artifactsRoot,
          'repogen',
          job.assignmentId,
          job.templateKey,
          `pack-v${packVersion}-${job.id}.docx`
        );
        await mkdir(dirname(artifactPath), { recursive: true });

        const fieldLines = fieldValues
          .slice(0, 40)
          .map((field: any) => {
            const key = field.sectionKey ? `${field.sectionKey}.${field.fieldKey}` : field.fieldKey;
            const value =
              typeof field.valueJson === 'string' || typeof field.valueJson === 'number'
                ? String(field.valueJson)
                : JSON.stringify(field.valueJson);
            return `${key}: ${value}`;
          });
        const evidenceLines = evidenceLinks
          .slice(0, 20)
          .map((link: any) => `${link.sectionKey || link.fieldKey || 'evidence'} -> ${link.document.originalFilename ?? link.document.id}`);

        const content = [
          'ZenOps Repogen Placeholder DOCX',
          `Job: ${job.id}`,
          `Assignment: ${assignment.id}`,
          `Template: ${job.templateKey}`,
          `Pack Version: ${packVersion}`,
          '',
          'Fields',
          ...fieldLines,
          '',
          'Evidence',
          ...evidenceLines
        ].join('\n');

        await writeFile(artifactPath, content, 'utf8');

        await tx.reportPackArtifact.create({
          data: {
            tenantId,
            reportPackId,
            kind: 'docx',
            filename: `${job.templateKey}-v${packVersion}.docx`,
            storageRef: artifactPath,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            sizeBytes: BigInt(Buffer.byteLength(content, 'utf8')),
            metadataJson: {
              placeholder: true,
              generated_by: 'repogen_worker_phase1',
              request_id: payload.requestId
            }
          }
        });
      }

      await tx.reportPack.update({
        where: { id: reportPackId },
        data: {
          status: 'generated',
          generatedAt: new Date()
        }
      });

      await tx.reportGenerationJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          finishedAt: new Date(),
          workerTrace: payload.requestId
        }
      });

      await tx.reportAuditLog.create({
        data: {
          tenantId,
          assignmentId: job.assignmentId,
          reportPackId,
          reportGenerationJobId: job.id,
          actorUserId: null,
          action: 'generation_completed',
          entityType: 'report_generation_job',
          entityId: job.id,
          metadataJson: {
            request_id: payload.requestId,
            pack_version: packVersion
          }
        }
      });
    });

    logger.info('repogen_job_succeeded', {
      request_id: payload.requestId,
      repogen_job_id: payload.reportGenerationJobId,
      assignment_id: payload.assignmentId
    });
  } catch (error) {
    logger.error('repogen_job_failed', {
      request_id: payload.requestId,
      repogen_job_id: payload.reportGenerationJobId,
      assignment_id: payload.assignmentId,
      error: error instanceof Error ? error.message : 'unknown'
    });

    try {
      await runWithContext(prisma, { tenantId, userId: null, aud: 'worker' }, async (tx) => {
        const job = await tx.reportGenerationJob.findFirst({
          where: {
            id: payload.reportGenerationJobId,
            tenantId
          },
          select: {
            id: true,
            assignmentId: true,
            reportPackId: true
          }
        });

        if (!job) {
          return;
        }

        await tx.reportGenerationJob.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            finishedAt: new Date(),
            workerTrace: payload.requestId,
            errorMessage: error instanceof Error ? error.message : 'unknown'
          }
        });

        if (job.reportPackId) {
          await tx.reportPack.update({
            where: { id: job.reportPackId },
            data: {
              status: 'failed'
            }
          });
        }

        await tx.reportAuditLog.create({
          data: {
            tenantId,
            assignmentId: job.assignmentId,
            reportPackId: job.reportPackId,
            reportGenerationJobId: job.id,
            actorUserId: null,
            action: 'generation_failed',
            entityType: 'report_generation_job',
            entityId: job.id,
            metadataJson: {
              request_id: payload.requestId,
              error: error instanceof Error ? error.message : 'unknown'
            }
          }
        });
      });
    } catch (auditError) {
      logger.error('repogen_job_failure_persist_error', {
        request_id: payload.requestId,
        repogen_job_id: payload.reportGenerationJobId,
        error: auditError instanceof Error ? auditError.message : 'unknown'
      });
    }

    throw error;
  }
};
