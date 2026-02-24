import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import type {
  RepogenDeliverablesReleaseRequest,
  RepogenReleaseDeliverablesResponse,
  RepogenWorkOrderPackLink
} from '@zenops/contracts';
import { Prisma, type TxClient } from '@zenops/db';
import { BillingControlService } from '../../billing-control/billing-control.service.js';
import type { RepogenQueuePayload } from '../../queue/repogen-queue.service.js';
import { RepogenSpineService } from '../repogen-spine.service.js';

type JsonRecord = Record<string, unknown>;

type BillingModeUpper = 'CREDIT' | 'POSTPAID';
type ReleaseGateResult = 'PAID' | 'CREDIT_CONSUMED' | 'OVERRIDE' | 'BLOCKED';

type EnsurePackResult = {
  idempotent: boolean;
  queue_enqueued: boolean;
  pack_link: RepogenWorkOrderPackLink;
  queue_payload?: RepogenQueuePayload;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const stableStringify = (value: unknown): string => {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map(normalize);
    }
    if (!isRecord(input)) {
      return input;
    }
    return Object.fromEntries(
      Object.keys(input)
        .sort()
        .map((key) => [key, normalize(input[key])])
    );
  };

  return JSON.stringify(normalize(value));
};

const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

const toIso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

const parseReadinessScore = (value: Prisma.JsonValue | null | undefined): number | null => {
  if (!isRecord(value) || typeof value.completeness_score !== 'number' || !Number.isFinite(value.completeness_score)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(value.completeness_score)));
};

const parseReadinessWarnings = (value: Prisma.JsonValue | null | undefined): string[] => {
  if (!isRecord(value) || !Array.isArray(value.warnings)) return [];
  return value.warnings.filter((item): item is string => typeof item === 'string');
};

const parseReadinessMissingFields = (value: Prisma.JsonValue | null | undefined): string[] => {
  if (!isRecord(value) || !Array.isArray(value.missing_fields)) return [];
  return value.missing_fields.filter((item): item is string => typeof item === 'string');
};

const parseReadinessMissingEvidence = (value: Prisma.JsonValue | null | undefined): string[] => {
  if (!isRecord(value) || !Array.isArray(value.missing_evidence)) return [];
  return value.missing_evidence.filter((item): item is string => typeof item === 'string');
};

@Injectable()
export class RepogenFactoryService {
  constructor(
    private readonly repogenSpineService: RepogenSpineService,
    private readonly billingControlService: BillingControlService
  ) {}

  private reportFamilyForWorkOrder(reportType: string): 'valuation' | 'dpr' | 'stage_progress' {
    if (reportType === 'DPR') return 'dpr';
    if (reportType === 'STAGE_PROGRESS') return 'stage_progress';
    return 'valuation';
  }

  private templateKeyForWorkOrder(workOrder: {
    reportType: string;
    templateSelector: string;
    bankType: string;
  }): string {
    if (workOrder.reportType === 'VALUATION' || workOrder.reportType === 'REVALUATION') {
      if (workOrder.templateSelector === 'SBI_FORMAT_A') return 'SBI_UNDER_5CR_V1';
      if (workOrder.templateSelector === 'BOI_PSU_GENERIC') return 'PSU_GENERIC_OVER_5CR_V1';
      if (workOrder.templateSelector === 'COOP_GENERIC') return 'COOP_LB_V1';
      if (workOrder.templateSelector === 'AGRI_GENERIC') return 'AGRI_GENERIC_V1';
    }

    return `REPOGEN_${workOrder.reportType}_${workOrder.templateSelector || workOrder.bankType || 'UNKNOWN'}_V1`;
  }

  private deriveBillingMode(workOrder: {
    billingModeCache: string | null;
    billingReservationId: string | null;
    billingServiceInvoiceId: string | null;
  }): BillingModeUpper | null {
    if (workOrder.billingModeCache === 'CREDIT' || workOrder.billingModeCache === 'POSTPAID') {
      return workOrder.billingModeCache;
    }
    if (workOrder.billingReservationId) return 'CREDIT';
    if (workOrder.billingServiceInvoiceId) return 'POSTPAID';
    return null;
  }

  private serializeArtifact(row: {
    id: string;
    kind: string;
    filename: string;
    storageRef: string;
    mimeType: string;
    sizeBytes: bigint;
    checksumSha256: string | null;
    metadataJson: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      kind: row.kind,
      filename: row.filename,
      storage_ref: row.storageRef,
      mime_type: row.mimeType,
      size_bytes: Number(row.sizeBytes),
      checksum_sha256: row.checksumSha256,
      metadata_json: isRecord(row.metadataJson) ? row.metadataJson : {},
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  private serializePack(row: {
    id: string;
    assignmentId: string;
    workOrderId: string | null;
    templateKey: string;
    reportFamily: string;
    version: number;
    status: string;
    warningsJson: Prisma.JsonValue;
    contextSnapshotJson: Prisma.JsonValue | null;
    generatedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    artifacts: Array<{
      id: string;
      kind: string;
      filename: string;
      storageRef: string;
      mimeType: string;
      sizeBytes: bigint;
      checksumSha256: string | null;
      metadataJson: Prisma.JsonValue;
      createdAt: Date;
      updatedAt: Date;
    }>;
  }) {
    return {
      id: row.id,
      assignment_id: row.assignmentId,
      work_order_id: row.workOrderId,
      template_key: row.templateKey,
      report_family: row.reportFamily,
      version: row.version,
      status: row.status,
      warnings: Array.isArray(row.warningsJson) ? (row.warningsJson as Array<Record<string, unknown>>) : [],
      context_snapshot: isRecord(row.contextSnapshotJson) ? row.contextSnapshotJson : null,
      generated_at: toIso(row.generatedAt),
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      artifacts: row.artifacts.map((artifact) => this.serializeArtifact(artifact))
    };
  }

  private serializeGenerationJob(row: {
    id: string;
    assignmentId: string;
    reportPackId: string | null;
    templateKey: string;
    reportFamily: string;
    idempotencyKey: string;
    status: string;
    attempts: number;
    errorMessage: string | null;
    workerTrace: string | null;
    requestPayloadJson: Prisma.JsonValue;
    warningsJson: Prisma.JsonValue;
    queuedAt: Date | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      assignment_id: row.assignmentId,
      report_pack_id: row.reportPackId,
      template_key: row.templateKey,
      report_family: row.reportFamily,
      idempotency_key: row.idempotencyKey,
      status: row.status,
      attempts: row.attempts,
      error_message: row.errorMessage,
      worker_trace: row.workerTrace,
      request_payload: isRecord(row.requestPayloadJson) ? row.requestPayloadJson : {},
      warnings: Array.isArray(row.warningsJson) ? (row.warningsJson as Array<Record<string, unknown>>) : [],
      queued_at: toIso(row.queuedAt),
      started_at: toIso(row.startedAt),
      finished_at: toIso(row.finishedAt),
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  private serializeRelease(row: {
    id: string;
    orgId: string;
    workOrderId: string;
    reportPackId: string;
    releasedByUserId: string | null;
    releasedAt: Date;
    billingModeAtRelease: string;
    billingGateResult: string;
    overrideReason: string | null;
    idempotencyKey: string;
    metadataJson: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      org_id: row.orgId,
      work_order_id: row.workOrderId,
      report_pack_id: row.reportPackId,
      released_by_user_id: row.releasedByUserId,
      released_at: row.releasedAt.toISOString(),
      billing_mode_at_release: row.billingModeAtRelease as BillingModeUpper,
      billing_gate_result: row.billingGateResult as ReleaseGateResult,
      override_reason: row.overrideReason,
      idempotency_key: row.idempotencyKey,
      metadata_json: isRecord(row.metadataJson) ? row.metadataJson : {},
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  private async appendReportAuditLog(
    tx: TxClient,
    input: {
      tenantId: string;
      assignmentId: string | null;
      actorUserId?: string | null;
      reportPackId?: string | null;
      reportGenerationJobId?: string | null;
      action: string;
      entityType: string;
      entityId?: string | null;
      metadataJson?: JsonRecord;
      beforeJson?: JsonRecord | null;
      afterJson?: JsonRecord | null;
    }
  ) {
    if (!input.assignmentId) {
      return;
    }

    await tx.reportAuditLog.create({
      data: {
        tenantId: input.tenantId,
        assignmentId: input.assignmentId,
        actorUserId: input.actorUserId ?? null,
        reportPackId: input.reportPackId ?? null,
        reportGenerationJobId: input.reportGenerationJobId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadataJson: asJson(input.metadataJson ?? {}),
        beforeJson: input.beforeJson ? (input.beforeJson as unknown as Prisma.InputJsonObject) : undefined,
        afterJson: input.afterJson ? (input.afterJson as unknown as Prisma.InputJsonObject) : undefined
      }
    });
  }

  private async getWorkOrderState(tx: TxClient, workOrderId: string) {
    const workOrder = await tx.repogenWorkOrder.findFirst({
      where: { id: workOrderId },
      include: {
        snapshots: {
          orderBy: { version: 'desc' },
          take: 1,
          select: {
            id: true,
            version: true,
            readinessJson: true,
            contractJson: true,
            derivedJson: true,
            createdAt: true
          }
        },
        reportPack: {
          include: {
            artifacts: {
              orderBy: [{ createdAt: 'asc' }]
            },
            generationJob: true
          }
        },
        factoryReportPack: {
          include: {
            artifacts: {
              orderBy: [{ createdAt: 'asc' }]
            },
            generationJob: true
          }
        },
        deliverableReleases: {
          orderBy: [{ createdAt: 'desc' }]
        }
      }
    });

    if (!workOrder) {
      throw new NotFoundException(`repogen work order ${workOrderId} not found`);
    }

    const linkedPack = workOrder.reportPack ?? workOrder.factoryReportPack ?? null;
    const latestSnapshot = workOrder.snapshots[0] ?? null;

    return {
      workOrder,
      linkedPack,
      latestSnapshot
    };
  }

  private async buildBillingGateStatus(tx: TxClient, workOrder: {
    orgId: string;
    billingModeCache: string | null;
    billingReservationId: string | null;
    billingServiceInvoiceId: string | null;
  }): Promise<RepogenWorkOrderPackLink['billing_gate_status']> {
    const mode = this.deriveBillingMode(workOrder);
    let invoiceStatus: string | null = null;
    let invoiceIsPaid: boolean | null = null;

    if (mode === 'POSTPAID' && workOrder.billingServiceInvoiceId) {
      try {
        const invoice = await this.billingControlService.getServiceInvoice(tx, workOrder.orgId, workOrder.billingServiceInvoiceId);
        invoiceStatus = typeof invoice.status === 'string' ? invoice.status : null;
        invoiceIsPaid = typeof invoice.is_paid === 'boolean' ? invoice.is_paid : invoice.status === 'PAID';
      } catch {
        invoiceStatus = 'NOT_FOUND';
        invoiceIsPaid = false;
      }
    }

    const releasableWithoutOverride =
      mode === 'CREDIT'
        ? Boolean(workOrder.billingReservationId)
        : mode === 'POSTPAID'
          ? Boolean(workOrder.billingServiceInvoiceId && invoiceIsPaid)
          : false;

    return {
      mode,
      reservation_id_present: Boolean(workOrder.billingReservationId),
      service_invoice_id: workOrder.billingServiceInvoiceId ?? null,
      service_invoice_status: invoiceStatus,
      service_invoice_is_paid: invoiceIsPaid,
      releasable_without_override: releasableWithoutOverride
    };
  }

  async getWorkOrderPackLink(tx: TxClient, workOrderId: string): Promise<RepogenWorkOrderPackLink> {
    const { workOrder, linkedPack, latestSnapshot } = await this.getWorkOrderState(tx, workOrderId);
    const billingGateStatus = await this.buildBillingGateStatus(tx, workOrder);

    return {
      work_order_id: workOrder.id,
      work_order_status: workOrder.status as RepogenWorkOrderPackLink['work_order_status'],
      readiness_score: parseReadinessScore(latestSnapshot?.readinessJson),
      value_slab: workOrder.valueSlab as RepogenWorkOrderPackLink['value_slab'],
      template_selector: workOrder.templateSelector as RepogenWorkOrderPackLink['template_selector'],
      pack: linkedPack ? this.serializePack(linkedPack) : null,
      generation_job: linkedPack?.generationJob ? this.serializeGenerationJob(linkedPack.generationJob) : null,
      deliverable_releases: workOrder.deliverableReleases.map((row) => this.serializeRelease(row)),
      billing_gate_status: billingGateStatus
    };
  }

  async ensureReportPackForWorkOrder(
    tx: TxClient,
    input: {
      work_order_id: string;
      actor_user_id: string | null;
      request_id?: string | null;
      requested_idempotency_key?: string | null;
    }
  ): Promise<EnsurePackResult> {
    const { workOrder, linkedPack, latestSnapshot } = await this.getWorkOrderState(tx, input.work_order_id);

    if (workOrder.status !== 'READY_FOR_RENDER') {
      throw new BadRequestException('PACK_CREATION_REQUIRES_READY_FOR_RENDER');
    }

    if (!workOrder.assignmentId) {
      throw new BadRequestException('ASSIGNMENT_REQUIRED_FOR_PACK_CREATION');
    }

    if (!latestSnapshot) {
      throw new BadRequestException('SNAPSHOT_REQUIRED_FOR_PACK_CREATION');
    }

    if (linkedPack?.generationJob) {
      return {
        idempotent: true,
        queue_enqueued: false,
        pack_link: await this.getWorkOrderPackLink(tx, workOrder.id)
      };
    }

    const exported = await this.repogenSpineService.exportWorkOrder(tx, workOrder.id, {
      snapshot_version: latestSnapshot.version
    });
    const exportBundle = (isRecord(exported) && isRecord(exported.export_bundle) ? exported.export_bundle : null) as JsonRecord | null;
    if (!exportBundle) {
      throw new ConflictException('REPOGEN_EXPORT_BUNDLE_MISSING');
    }

    const exportBundleStable = stableStringify(exportBundle);
    const exportBundleHash = sha256Hex(exportBundleStable);
    const templateKey = this.templateKeyForWorkOrder(workOrder);
    const reportFamily = this.reportFamilyForWorkOrder(workOrder.reportType);
    const warnings = [
      ...parseReadinessWarnings(latestSnapshot.readinessJson),
      ...parseReadinessMissingFields(latestSnapshot.readinessJson).map((field) => `missing_field:${field}`),
      ...parseReadinessMissingEvidence(latestSnapshot.readinessJson).map((evidence) => `missing_evidence:${evidence}`)
    ];

    const packVersion =
      (await tx.reportPack.findFirst({
        where: {
          tenantId: workOrder.orgId,
          assignmentId: workOrder.assignmentId,
          templateKey
        },
        orderBy: { version: 'desc' },
        select: { version: true }
      }))?.version ?? 0;

    const nextPackVersion = packVersion + 1;
    const existingPack = linkedPack;
    let reportPackId = existingPack?.id ?? null;
    let job = existingPack?.generationJob ?? null;

    if (!reportPackId) {
      const pack = await tx.reportPack.create({
        data: {
          tenantId: workOrder.orgId,
          assignmentId: workOrder.assignmentId,
          workOrderId: workOrder.id,
          templateVersionId: null,
          templateKey,
          reportFamily,
          version: nextPackVersion,
          status: 'generating',
          createdByUserId: input.actor_user_id,
          warningsJson: warnings.map((message) => ({ code: 'READINESS_CONTEXT', severity: 'warn', message })),
          contextSnapshotJson: {
            source: 'repogen_factory_bridge',
            work_order_id: workOrder.id,
            snapshot_version: latestSnapshot.version,
            export_bundle_hash: exportBundleHash,
            template_selector: workOrder.templateSelector,
            value_slab: workOrder.valueSlab
          }
        },
        include: {
          artifacts: true,
          generationJob: true
        }
      });
      reportPackId = pack.id;

      await tx.repogenWorkOrder.update({
        where: { id: workOrder.id },
        data: {
          reportPackId: pack.id
        }
      });

      await tx.reportPackArtifact.create({
        data: {
          tenantId: workOrder.orgId,
          reportPackId: pack.id,
          kind: 'debug_json',
          filename: `repogen-export-bundle-v${latestSnapshot.version}.json`,
          storageRef: `repogen://work-orders/${workOrder.id}/snapshots/${latestSnapshot.version}/export-bundle`,
          mimeType: 'application/json',
          sizeBytes: BigInt(Buffer.byteLength(exportBundleStable, 'utf8')),
          checksumSha256: exportBundleHash,
          metadataJson: asJson({
            placeholder: true,
            purpose: 'repogen_export_bundle_snapshot',
            work_order_id: workOrder.id,
            snapshot_version: latestSnapshot.version,
            template_selector: workOrder.templateSelector,
            export_bundle_hash: exportBundleHash,
            export_bundle: exportBundle
          })
        }
      });

      await this.appendReportAuditLog(tx, {
        tenantId: workOrder.orgId,
        assignmentId: workOrder.assignmentId,
        actorUserId: input.actor_user_id,
        reportPackId: pack.id,
        action: 'pack_created',
        entityType: 'report_pack',
        entityId: pack.id,
        metadataJson: {
          source: 'repogen_factory_bridge',
          work_order_id: workOrder.id,
          snapshot_version: latestSnapshot.version,
          export_bundle_hash: exportBundleHash
        }
      });
    }

    if (!job) {
      const jobIdempotencyKey =
        input.requested_idempotency_key?.trim() ||
        `repogen_factory_generate:${workOrder.id}:v${latestSnapshot.version}`;

      const existingJob = await tx.reportGenerationJob.findFirst({
        where: {
          tenantId: workOrder.orgId,
          idempotencyKey: jobIdempotencyKey
        }
      });

      job = existingJob
        ? existingJob
        : await tx.reportGenerationJob.create({
            data: {
              tenantId: workOrder.orgId,
              assignmentId: workOrder.assignmentId,
              templateVersionId: null,
              templateKey,
              reportFamily,
              idempotencyKey: jobIdempotencyKey,
              status: 'queued',
              queuedAt: new Date(),
              requestedByUserId: input.actor_user_id,
              reportPackId: reportPackId!,
              requestPayloadJson: asJson({
                repogen_factory: true,
                source: 'repogen_work_order_bridge',
                work_order_id: workOrder.id,
                snapshot_version: latestSnapshot.version,
                template_selector: workOrder.templateSelector,
                value_slab: workOrder.valueSlab,
                export_bundle_hash: exportBundleHash,
                export_bundle: exportBundle
              }),
              warningsJson: warnings.map((message) => ({ code: 'READINESS_CONTEXT', severity: 'warn', message }))
            }
          });

      await this.appendReportAuditLog(tx, {
        tenantId: workOrder.orgId,
        assignmentId: workOrder.assignmentId,
        actorUserId: input.actor_user_id,
        reportPackId: reportPackId,
        reportGenerationJobId: job.id,
        action: 'generation_requested',
        entityType: 'report_generation_job',
        entityId: job.id,
        metadataJson: {
          source: 'repogen_factory_bridge',
          work_order_id: workOrder.id,
          snapshot_version: latestSnapshot.version,
          export_bundle_hash: exportBundleHash,
          idempotency_key: job.idempotencyKey
        }
      });
    }

    const packLink = await this.getWorkOrderPackLink(tx, workOrder.id);
    return {
      idempotent: Boolean(linkedPack?.generationJob),
      queue_enqueued: false,
      pack_link: packLink,
      queue_payload: {
        reportGenerationJobId: job!.id,
        assignmentId: workOrder.assignmentId,
        tenantId: workOrder.orgId,
        requestId: input.request_id?.trim() || 'repogen-factory'
      }
    };
  }

  async releaseDeliverables(
    tx: TxClient,
    input: {
      work_order_id: string;
      actor_user_id: string | null;
      request: RepogenDeliverablesReleaseRequest;
    }
  ): Promise<RepogenReleaseDeliverablesResponse> {
    const requestIdem = input.request.idempotency_key.trim();
    if (!requestIdem) {
      throw new BadRequestException('IDEMPOTENCY_KEY_REQUIRED');
    }
    if (input.request.override && !input.request.override_reason?.trim()) {
      throw new BadRequestException('OVERRIDE_REASON_REQUIRED');
    }

    const { workOrder, linkedPack } = await this.getWorkOrderState(tx, input.work_order_id);
    if (!linkedPack) {
      throw new BadRequestException('REPORT_PACK_NOT_LINKED');
    }

    const existingByKey = await tx.repogenDeliverableRelease.findFirst({
      where: {
        orgId: workOrder.orgId,
        idempotencyKey: requestIdem
      }
    });
    if (existingByKey) {
      return {
        idempotent: true,
        blocked: existingByKey.billingGateResult === 'BLOCKED',
        pack_link: await this.getWorkOrderPackLink(tx, workOrder.id),
        release: this.serializeRelease(existingByKey)
      };
    }

    const generationJob = await tx.reportGenerationJob.findFirst({
      where: {
        reportPackId: linkedPack.id
      }
    });
    if (!generationJob || generationJob.status !== 'completed') {
      throw new BadRequestException('PACK_GENERATION_NOT_COMPLETED');
    }

    const priorRelease = await tx.repogenDeliverableRelease.findFirst({
      where: {
        workOrderId: workOrder.id,
        reportPackId: linkedPack.id,
        billingGateResult: {
          in: ['PAID', 'CREDIT_CONSUMED', 'OVERRIDE']
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    if (priorRelease) {
      return {
        idempotent: true,
        blocked: false,
        pack_link: await this.getWorkOrderPackLink(tx, workOrder.id),
        release: this.serializeRelease(priorRelease)
      };
    }

    const billingMode = this.deriveBillingMode(workOrder) ?? 'POSTPAID';
    let gateResult: ReleaseGateResult = 'BLOCKED';
    let blockedReason: string | null = null;
    let consumeLedgerId: string | null = null;
    let invoiceStatus: string | null = null;
    let invoiceIsPaid: boolean | null = null;

    if (billingMode === 'CREDIT') {
      if (workOrder.billingReservationId) {
        if (input.request.override) {
          gateResult = 'OVERRIDE';
        } else {
          const ledger = await this.billingControlService.consumeCredits(tx, {
            account_id: workOrder.billingAccountId ?? undefined,
            reservation_id: workOrder.billingReservationId,
            idempotency_key: `repogen_release_consume:${requestIdem}`
          });
          consumeLedgerId = ledger.id;
          gateResult = 'CREDIT_CONSUMED';
        }
      } else if (input.request.override) {
        gateResult = 'OVERRIDE';
        blockedReason = 'credit_reservation_missing_override';
      } else {
        gateResult = 'BLOCKED';
        blockedReason = 'credit_reservation_missing';
      }
    } else {
      if (workOrder.billingServiceInvoiceId) {
        const invoice = await this.billingControlService.getServiceInvoice(tx, workOrder.orgId, workOrder.billingServiceInvoiceId);
        invoiceStatus = typeof invoice.status === 'string' ? invoice.status : null;
        invoiceIsPaid = typeof invoice.is_paid === 'boolean' ? invoice.is_paid : invoice.status === 'PAID';
        if (invoiceIsPaid) {
          gateResult = 'PAID';
        } else if (input.request.override) {
          gateResult = 'OVERRIDE';
          blockedReason = 'invoice_unpaid_override';
        } else {
          gateResult = 'BLOCKED';
          blockedReason = 'invoice_unpaid';
        }
      } else if (input.request.override) {
        gateResult = 'OVERRIDE';
        blockedReason = 'service_invoice_missing_override';
      } else {
        gateResult = 'BLOCKED';
        blockedReason = 'service_invoice_missing';
      }
    }

    const release = await tx.repogenDeliverableRelease.create({
      data: {
        orgId: workOrder.orgId,
        workOrderId: workOrder.id,
        reportPackId: linkedPack.id,
        releasedByUserId: input.actor_user_id,
        billingModeAtRelease: billingMode,
        billingGateResult: gateResult,
        overrideReason: input.request.override ? input.request.override_reason?.trim() ?? null : null,
        idempotencyKey: requestIdem,
        metadataJson: {
          blocked_reason: blockedReason,
          report_generation_job_id: generationJob.id,
          report_generation_job_status: generationJob.status,
          billing_account_id: workOrder.billingAccountId,
          billing_reservation_id: workOrder.billingReservationId,
          billing_service_invoice_id: workOrder.billingServiceInvoiceId,
          billing_service_invoice_status: invoiceStatus,
          billing_service_invoice_is_paid: invoiceIsPaid,
          credit_consume_ledger_id: consumeLedgerId,
          override_requested: Boolean(input.request.override)
        }
      }
    });

    const billingHooks = isRecord(workOrder.billingHooksJson) ? { ...workOrder.billingHooksJson } : {};
    billingHooks.deliverables_release = {
      release_id: release.id,
      released_at: release.releasedAt.toISOString(),
      billing_gate_result: release.billingGateResult,
      report_pack_id: linkedPack.id,
      idempotency_key: requestIdem,
      override: Boolean(input.request.override),
      override_reason: input.request.override ? input.request.override_reason?.trim() ?? null : null
    };
    billingHooks.deliverables_released_at = release.releasedAt.toISOString();

    await tx.repogenWorkOrder.update({
      where: { id: workOrder.id },
      data: {
        billingHooksJson: asJson(billingHooks)
      }
    });

    if (workOrder.billingAccountId) {
      await this.billingControlService.ingestUsageEvent(tx, {
        source_system: 'v2',
        event_type:
          gateResult === 'BLOCKED' ? 'repogen_deliverables_release_blocked' : 'repogen_deliverables_released',
        account_id: workOrder.billingAccountId,
        payload_json: {
          repogen_work_order_id: workOrder.id,
          assignment_id: workOrder.assignmentId,
          report_pack_id: linkedPack.id,
          release_id: release.id,
          billing_gate_result: gateResult,
          override: Boolean(input.request.override)
        },
        idempotency_key: `v2:repogen_deliverables_release:${requestIdem}`
      });
    }

    await this.appendReportAuditLog(tx, {
      tenantId: workOrder.orgId,
      assignmentId: workOrder.assignmentId,
      actorUserId: input.actor_user_id,
      reportPackId: linkedPack.id,
      reportGenerationJobId: generationJob.id,
      action: gateResult === 'BLOCKED' ? 'deliverables_release_blocked' : 'deliverables_released',
      entityType: 'repogen_deliverable_release',
      entityId: release.id,
      metadataJson: {
        repogen_work_order_id: workOrder.id,
        billing_gate_result: gateResult,
        override: Boolean(input.request.override),
        override_reason: input.request.override ? input.request.override_reason?.trim() ?? null : null
      }
    });

    return {
      idempotent: false,
      blocked: gateResult === 'BLOCKED',
      pack_link: await this.getWorkOrderPackLink(tx, workOrder.id),
      release: this.serializeRelease(release)
    };
  }
}

export type { EnsurePackResult };
