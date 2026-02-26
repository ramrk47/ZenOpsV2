import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import type { Logger } from '@zenops/common';
import { buildRenderContext, resolveRecipe, TEMPLATE_KEY_TO_FAMILY } from '@zenops/common';
import type { ManifestJson } from '@zenops/common';
import { withTxContext, type PrismaClient } from '@zenops/db';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import pLimit from 'p-limit';
import archiver from 'archiver';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream } from 'node:fs';

const execFileAsync = promisify(execFile);
const pdfConvertLimit = pLimit(1);


function toString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  return String(v);
}

/** Spawn a Python3 script, resolve when exit 0, reject with stderr on non-zero. */
function spawnPython(scriptPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [scriptPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Python script ${scriptPath} exited ${code}: ${stderr.slice(0, 500)}`));
    });
  });
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

  const jobStartMs = Date.now();

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

      const [assignment, tenant] = await Promise.all([
        tx.assignment.findFirst({
          where: {
            id: job.assignmentId,
            tenantId,
            deletedAt: null
          },
          select: {
            id: true,
            title: true
          }
        }),
        tx.tenant.findUnique({
          where: { id: tenantId },
          select: { repogenFeaturesJson: true }
        })
      ]);

      if (!assignment || !tenant) {
        throw new Error(`assignment ${job.assignmentId} or tenant ${tenantId} not found`);
      }

      const features = (tenant.repogenFeaturesJson || {}) as any;

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
        const zipArtifacts: Array<{ filename: string, kind: string, checksumSha256: string | null, sizeBytes: bigint, storageRef: string }> = [];

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

          // Check for unresolved single-brace {tag} placeholders (docxtemplater convention)
          const outputText = contentBuffer.toString('utf8');
          // Match {tag.path} but not {#loop} markers since docxtemplater removes those on render
          const MANUAL_PREFIXES = ['manual.', 'construction.ageYears', 'construction.residualLife'];
          const unresolvedMatch = (outputText.match(/\{([a-zA-Z_][a-zA-Z0-9_.]+)\}/g) ?? [])
            .filter(tag => !MANUAL_PREFIXES.some(p => tag.slice(1, -1).startsWith(p)));
          if (unresolvedMatch.length > 0) {
            logger.warn('m5_7_placeholder_unresolved', {
              request_id: payload.requestId,
              part_name: part.name,
              unresolved_count: unresolvedMatch.length,
              examples: unresolvedMatch.slice(0, 5)
            });
          }

          await writeFile(artifactPath, contentBuffer);

          // ── Stage B: Image embedding (images part only) ──
          if (part.name === 'images' && renderContext.evidence.photos.length > 0) {
            if (features?.enable_image_classifier !== true) {
              logger.info('m5_7_4_image_classifier_disabled', {
                request_id: payload.requestId,
                part_name: part.name,
                tenant_id: tenantId
              });
            } else {
              const photosTmp = join(tmpdir(), `zenops-photos-${job.id}.json`);
              const classifiedTmp = join(tmpdir(), `zenops-classified-${job.id}.json`);
              const scriptsDir = join(__dirname, '../../../scripts');

              // Build photo records for classifier
              const photoRecords = renderContext.evidence.photos.map((p, i) => ({
                filename: p.filename,
                path: '',      // no local path at this stage; classifier uses sectionKey
                contentType: p.type === 'gps' ? 'image/jpeg' : 'image/jpeg',
                sectionKey: p.type,
                sortOrder: i,
                caption: p.filename
              }));
              await writeFile(photosTmp, JSON.stringify(photoRecords));

              try {
                // Classify
                await spawnPython(join(scriptsDir, 'classify_photos.py'), [
                  '--photos', photosTmp,
                  '--output', classifiedTmp
                ]);

                // Embed
                await spawnPython(join(scriptsDir, 'embed_images.py'), [
                  '--docx', artifactPath,
                  '--photos', classifiedTmp,
                  '--output', artifactPath
                ]);

                logger.info('m5_7_4_images_embedded', {
                  request_id: payload.requestId,
                  part_name: part.name,
                  photo_count: photoRecords.length
                });
              } catch (embedErr: any) {
                // Non-fatal: log and continue (text DOCX is still valid)
                logger.warn('m5_7_4_image_embed_failed', {
                  request_id: payload.requestId,
                  part_name: part.name,
                  error: embedErr.message
                });
              } finally {
                await unlink(photosTmp).catch(() => { });
                await unlink(classifiedTmp).catch(() => { });
              }
            }
          }

          const docxArtifact = await tx.reportPackArtifact.create({
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

          zipArtifacts.push({
            filename: `${job.templateKey}-${part.name}-v${packVersion}.docx`,
            kind: 'docx',
            checksumSha256: null,
            sizeBytes: BigInt(contentBuffer.length),
            storageRef: artifactPath
          });

          // ── M5.7.5: Stage C - PDF Conversion ──
          if (features?.enable_pdf_conversion !== true) {
            logger.info('pdf_convert_disabled', {
              request_id: payload.requestId,
              part_name: part.name,
              tenant_id: tenantId
            });
          } else {
            const pdfPath = join(
              artifactsRoot,
              'repogen',
              job.assignmentId,
              job.templateKey,
              `${part.name}-v${packVersion}-${job.id}.pdf`
            );
            let pdfStatus = 'SKIPPED';
            let pdfSizeBytes = 0;
            let pdfError = undefined;

            logger.info('pdf_convert_started', {
              request_id: payload.requestId,
              part_name: part.name
            });

            try {
              await pdfConvertLimit(async () => {
                // 90s timeout enforces isolation limit
                await execFileAsync('soffice', [
                  '--headless',
                  '--nologo',
                  '--nofirststartwizard',
                  '--nodefault',
                  '--norestore',
                  '--convert-to', 'pdf',
                  '--outdir', dirname(artifactPath),
                  artifactPath
                ], { timeout: 90000 });
              });
              const pdfBuffer = await readFile(pdfPath);
              pdfSizeBytes = pdfBuffer.length;
              pdfStatus = 'GENERATED';
              logger.info('pdf_convert_succeeded', {
                request_id: payload.requestId,
                part_name: part.name,
                size_bytes: pdfSizeBytes
              });
            } catch (pdfErr: any) {
              if (pdfErr.code === 'ENOENT' || pdfErr.message.includes('ENOENT')) {
                pdfStatus = 'SKIPPED';
                pdfError = 'soffice_missing';
                logger.info('pdf_convert_skipped_soffice_missing', {
                  request_id: payload.requestId,
                  part_name: part.name
                });
              } else {
                pdfStatus = 'FAILED';
                pdfError = pdfErr.message;
                logger.warn('pdf_convert_failed', {
                  request_id: payload.requestId,
                  part_name: part.name,
                  error: pdfError
                });
              }
            }

            if (pdfStatus === 'GENERATED') {
              await tx.reportPackArtifact.create({
                data: {
                  tenantId,
                  reportPackId,
                  kind: 'pdf',
                  filename: `${job.templateKey}-${part.name}-v${packVersion}.pdf`,
                  storageRef: pdfPath,
                  mimeType: 'application/pdf',
                  sizeBytes: BigInt(pdfSizeBytes),
                  metadataJson: {
                    ...docxArtifact.metadataJson as Record<string, unknown>,
                    generated_by: 'soffice'
                  }
                }
              });

              zipArtifacts.push({
                filename: `${job.templateKey}-${part.name}-v${packVersion}.pdf`,
                kind: 'pdf',
                checksumSha256: null,
                sizeBytes: BigInt(pdfSizeBytes),
                storageRef: pdfPath
              });
            }
          }
        }

        // ── M5.7.6: Pack Assembly (ZIP) ──
        const zipPath = join(
          artifactsRoot,
          'repogen',
          job.assignmentId,
          job.templateKey,
          `${job.templateKey}-pack-v${packVersion}-${renderContext.meta.exportHash.slice(0, 8)}.zip`
        );

        const metaJson: Record<string, unknown> = {
          export_hash: renderContext.meta.exportHash,
          template_hash: renderContext.meta.templateHash,
          context_version: packVersion, // Approximation for now
          generated_at: new Date().toISOString(),
          pack_version: packVersion,
          artifacts: zipArtifacts.map((a: { filename: string, kind: string, checksumSha256: string | null, sizeBytes: bigint }) => ({
            filename: a.filename,
            kind: a.kind,
            sha256: a.checksumSha256,
            size: Number(a.sizeBytes)
          }))
        };

        await new Promise<void>((resolve, reject) => {
          const output = createWriteStream(zipPath);
          const archive = archiver('zip', { zlib: { level: 9 } });

          output.on('close', () => resolve());
          archive.on('error', (err: Error) => reject(err));

          archive.pipe(output);

          for (const a of zipArtifacts) {
            archive.file(a.storageRef, { name: a.filename });
          }
          archive.append(JSON.stringify(metaJson, null, 2), { name: 'meta.json' });

          void archive.finalize();
        });

        const zipStat = await readFile(zipPath);

        await tx.reportPackArtifact.create({
          data: {
            tenantId,
            reportPackId,
            kind: 'zip',
            filename: `${job.templateKey}-pack-v${packVersion}.zip`,
            storageRef: zipPath,
            mimeType: 'application/zip',
            sizeBytes: BigInt(zipStat.length),
            metadataJson: metaJson
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

      const artifactCount = await tx.reportPackArtifact.count({
        where: { reportPackId: reportPackId! }
      });

      const jobSummary = {
        started_at: new Date(jobStartMs).toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - jobStartMs,
        artifact_count: artifactCount,
        features: {
          pdf_conversion: features?.enable_pdf_conversion === true,
          image_classifier: features?.enable_image_classifier === true
        }
      };

      await tx.reportGenerationJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          finishedAt: new Date(),
          workerTrace: payload.requestId,
          jobSummaryJson: jobSummary
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
