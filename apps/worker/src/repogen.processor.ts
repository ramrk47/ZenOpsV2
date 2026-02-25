import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Logger } from '@zenops/common';
import { buildRenderContext, resolveRecipe, TEMPLATE_KEY_TO_FAMILY } from '@zenops/common';
import type { ManifestJson } from '@zenops/common';
import { withTxContext, type PrismaClient } from '@zenops/db';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { readFile } from 'node:fs/promises';

function toString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  return String(v);
}

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stableStringify = (value: unknown): string => {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (!isRecord(input)) return input;
    return Object.fromEntries(
      Object.keys(input)
        .sort()
        .map((key) => [key, normalize(input[key])])
    );
  };
  return JSON.stringify(normalize(value));
};

const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

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

      const requestPayload = isRecord(job.requestPayloadJson) ? job.requestPayloadJson : {};
      const factoryPayload =
        requestPayload.repogen_factory === true && isRecord(requestPayload.export_bundle)
          ? {
            workOrderId: typeof requestPayload.work_order_id === 'string' ? requestPayload.work_order_id : null,
            snapshotVersion:
              typeof requestPayload.snapshot_version === 'number' && Number.isFinite(requestPayload.snapshot_version)
                ? Math.trunc(requestPayload.snapshot_version)
                : null,
            templateSelector:
              typeof requestPayload.template_selector === 'string' ? requestPayload.template_selector : null,
            exportBundle: requestPayload.export_bundle,
            exportBundleHash:
              typeof requestPayload.export_bundle_hash === 'string'
                ? requestPayload.export_bundle_hash
                : sha256Hex(stableStringify(requestPayload.export_bundle))
          }
          : null;

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
        // ── Resolve pack recipe from manifest ──
        const familyKey = TEMPLATE_KEY_TO_FAMILY[job.templateKey] ?? job.templateKey.toLowerCase();
        const familyDir = join(__dirname, '../../../docs/templates/samples', familyKey);
        let manifest: ManifestJson;
        try {
          const manifestRaw = await readFile(join(familyDir, 'manifest.json'), 'utf8');
          manifest = JSON.parse(manifestRaw) as ManifestJson;
        } catch {
          logger.warn('m5_7_template_missing', {
            request_id: payload.requestId,
            repogen_job_id: payload.reportGenerationJobId,
            template_key: job.templateKey,
            error: `manifest.json not found for family '${familyKey}'`
          });
          throw new Error(`M5_7_TEMPLATE_MISSING: manifest.json not found for family '${familyKey}'. Verify docs/templates/samples/${familyKey}/manifest.json exists.`);
        }

        const recipe = resolveRecipe(familyKey, manifest);

        // ── Build render context from DB snapshot ──
        const fp = factoryPayload as Record<string, any> | null;
        const renderContext = buildRenderContext({
          assignmentId: job.assignmentId,
          templateKey: job.templateKey,
          bankName: toString(fp?.bankName) || manifest.bank_family,
          branchName: toString(fp?.branchName) || '',
          reportFamily: job.reportFamily || manifest.report_type,
          fieldValues: fieldValues as any[],
          evidenceLinks: evidenceLinks as any[],
          exportHash: fp?.exportBundleHash ? String(fp.exportBundleHash) : sha256Hex(stableStringify(fieldValues)),
          templateHash: sha256Hex(familyKey),
          factoryPayload: fp ?? undefined
        });

        // ── Render each pack part ──
        for (const part of recipe.parts) {
          const templatePath = join(familyDir, part.templateFile);
          const artifactPath = join(
            artifactsRoot,
            'repogen',
            job.assignmentId,
            job.templateKey,
            `${part.name}-v${packVersion}-${job.id}.docx`
          );
          await mkdir(dirname(artifactPath), { recursive: true });

          let contentBuffer: Buffer;
          try {
            const templateSource = await readFile(templatePath, 'binary');
            const zip = new PizZip(templateSource);
            const doc = new Docxtemplater(zip, {
              paragraphLoop: true,
              linebreaks: true,
              nullGetter: () => ''
            });

            doc.render(renderContext as any);
            contentBuffer = doc.getZip().generate({
              type: 'nodebuffer',
              compression: 'DEFLATE'
            });
          } catch (error: any) {
            if (part.required) {
              logger.warn('m5_7_corrupt_template', {
                request_id: payload.requestId,
                repogen_job_id: payload.reportGenerationJobId,
                template_key: job.templateKey,
                part_name: part.name,
                error: error.message
              });
              throw new Error(`M5_7_CORRUPT_TEMPLATE: Could not render '${part.name}' for '${job.templateKey}'. Error: ${error.message}`);
            }
            // Optional part failed — skip with warning
            logger.warn('m5_7_optional_part_skipped', {
              request_id: payload.requestId,
              part_name: part.name,
              error: error.message
            });
            continue;
          }

          // Check for unresolved placeholders
          const outputText = contentBuffer.toString('utf8');
          const unresolvedMatch = outputText.match(/\{\{[^}]+\}\}/g);
          if (unresolvedMatch && unresolvedMatch.length > 0) {
            logger.warn('m5_7_placeholder_unresolved', {
              request_id: payload.requestId,
              part_name: part.name,
              unresolved_count: unresolvedMatch.length
            });
          }

          await writeFile(artifactPath, contentBuffer);

          await tx.reportPackArtifact.create({
            data: {
              tenantId,
              reportPackId,
              kind: 'docx',
              filename: `${job.templateKey}-${part.name}-v${packVersion}.docx`,
              storageRef: artifactPath,
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              sizeBytes: BigInt(contentBuffer.length),
              metadataJson: {
                generated_by: 'docxtemplater',
                part_name: part.name,
                export_hash: renderContext.meta.exportHash,
                template_hash: renderContext.meta.templateHash,
                request_id: payload.requestId,
                ...(factoryPayload
                  ? {
                    repogen_factory: true,
                    work_order_id: factoryPayload.workOrderId,
                    snapshot_version: factoryPayload.snapshotVersion,
                    template_selector: factoryPayload.templateSelector,
                    export_bundle_hash: factoryPayload.exportBundleHash
                  }
                  : {})
              }
            }
          });
        }
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
