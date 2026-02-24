import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  RepogenContractSchema,
  type RepogenCommentCreate,
  type RepogenContract,
  type RepogenContractPatchRequest,
  type RepogenExportQuery,
  type RepogenEvidenceLinkRequest,
  type RepogenStatusTransition,
  type RepogenWorkOrderCreate,
  type RepogenWorkOrderListQuery,
  type RepogenWorkOrderStatus
} from '@zenops/contracts';
import { Prisma, type TxClient } from '@zenops/db';
import { BillingControlService } from '../billing-control/billing-control.service.js';
import {
  evaluateRepogenReadiness,
  type RepogenEvidenceLike,
  type RepogenEvidenceProfileRequirementLike,
  type RepogenReadinessResult
} from './readiness/evaluator.js';
import { computeRepogenContract } from './rules/engine.js';
import { chooseDefaultRepogenEvidenceProfile } from './evidence-intelligence/defaults.js';

type JsonObject = Record<string, unknown>;

type RepogenWorkOrderRow = Awaited<ReturnType<RepogenSpineService['getWorkOrderOrThrow']>>;

type RepogenSnapshotRow = {
  id: string;
  version: number;
  contractJson: Prisma.JsonValue;
  derivedJson: Prisma.JsonValue;
  readinessJson: Prisma.JsonValue;
  createdByUserId: string | null;
  createdAt: Date;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const toJsonValue = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const toIso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
};

const parseWarningsJson = (value: Prisma.JsonValue): Array<Record<string, unknown>> => {
  if (!Array.isArray(value)) return [];
  const rows: Array<Record<string, unknown>> = [];
  for (const item of value) {
    if (isRecord(item)) {
      rows.push(item);
    }
  }
  return rows;
};

const parseContractJson = (value: Prisma.JsonValue | null | undefined): RepogenContract | null => {
  if (!isRecord(value)) return null;
  const parsed = RepogenContractSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const parseReadinessJson = (value: Prisma.JsonValue | null | undefined): RepogenReadinessResult | null => {
  if (!isRecord(value)) return null;

  const completenessScore = typeof value.completeness_score === 'number' ? value.completeness_score : null;
  if (completenessScore === null || !Number.isFinite(completenessScore)) {
    return null;
  }

  const requiredEvidenceMinimums = isRecord(value.required_evidence_minimums)
    ? Object.fromEntries(
        Object.entries(value.required_evidence_minimums)
          .filter(([, raw]) => typeof raw === 'number' && Number.isFinite(raw))
          .map(([key, raw]) => [key, Number(raw)])
      )
    : {};

  return {
    completeness_score: Math.max(0, Math.min(100, Math.round(completenessScore))),
    missing_fields: asStringArray(value.missing_fields),
    missing_evidence: asStringArray(value.missing_evidence),
    missing_field_evidence_links: asStringArray((value as Record<string, unknown>).missing_field_evidence_links),
    warnings: asStringArray(value.warnings),
    required_evidence_minimums: requiredEvidenceMinimums
  };
};

const deepMerge = (base: unknown, patch: unknown): unknown => {
  if (patch === undefined) return cloneJson(base);
  if (patch === null) return null;

  if (Array.isArray(patch)) {
    return cloneJson(patch);
  }

  if (!isRecord(patch)) {
    return cloneJson(patch);
  }

  const baseRecord = isRecord(base) ? base : {};
  const output: Record<string, unknown> = { ...cloneJson(baseRecord) };
  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === undefined) {
      continue;
    }
    output[key] = deepMerge(baseRecord[key], patchValue);
  }
  return output;
};

const readinessBlocksStatus = (readiness: RepogenReadinessResult): boolean =>
  readiness.missing_fields.length > 0 || readiness.missing_evidence.length > 0;

const ALLOWED_TRANSITIONS: Record<RepogenWorkOrderStatus, RepogenWorkOrderStatus[]> = {
  DRAFT: ['EVIDENCE_PENDING', 'DATA_PENDING', 'CANCELLED'],
  EVIDENCE_PENDING: ['DATA_PENDING', 'CANCELLED'],
  DATA_PENDING: ['READY_FOR_RENDER', 'CANCELLED', 'CLOSED'],
  READY_FOR_RENDER: ['CLOSED', 'CANCELLED'],
  CANCELLED: [],
  CLOSED: []
};

@Injectable()
export class RepogenSpineService {
  constructor(private readonly billingControlService: BillingControlService) {}

  private baseContractForWorkOrder(workOrder: {
    reportType: string;
    bankType: string;
    bankName: string;
  }): RepogenContract {
    const base = RepogenContractSchema.parse({});
    base.meta.report_type = workOrder.reportType as RepogenContract['meta']['report_type'];
    base.meta.bank_type = workOrder.bankType as RepogenContract['meta']['bank_type'];
    base.party.bank_name = workOrder.bankName;
    return base;
  }

  private serializeWorkOrder(row: {
    id: string;
    orgId: string;
    sourceType: string;
    sourceRefId: string | null;
    assignmentId: string | null;
    reportType: string;
    bankName: string;
    bankType: string;
    valueSlab: string;
    templateSelector: string;
    status: string;
    reportPackId: string | null;
    evidenceProfileId: string | null;
    billingModeCache: string | null;
    billingAccountId: string | null;
    billingReservationId: string | null;
    billingServiceInvoiceId: string | null;
    billingHooksJson: Prisma.JsonValue;
    createdByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      org_id: row.orgId,
      source_type: row.sourceType,
      source_ref_id: row.sourceRefId,
      assignment_id: row.assignmentId,
      report_type: row.reportType,
      bank_name: row.bankName,
      bank_type: row.bankType,
      value_slab: row.valueSlab,
      template_selector: row.templateSelector,
      status: row.status,
      report_pack_id: row.reportPackId,
      evidence_profile_id: row.evidenceProfileId,
      billing: {
        mode_cache: row.billingModeCache,
        account_id: row.billingAccountId,
        reservation_id: row.billingReservationId,
        service_invoice_id: row.billingServiceInvoiceId,
        hooks: isRecord(row.billingHooksJson) ? row.billingHooksJson : {}
      },
      created_by_user_id: row.createdByUserId,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  private serializeSnapshot(row: RepogenSnapshotRow | null) {
    if (!row) return null;
    return {
      id: row.id,
      version: row.version,
      contract_json: row.contractJson,
      derived_json: row.derivedJson,
      readiness_json: row.readinessJson,
      created_by_user_id: row.createdByUserId,
      created_at: row.createdAt.toISOString()
    };
  }

  private serializeEvidence(row: {
    id: string;
    evidenceType: string;
    docType: string | null;
    classification: string | null;
    sensitivity: string | null;
    source: string | null;
    documentId: string | null;
    fileRef: string | null;
    capturedByEmployeeId: string | null;
    capturedAt: Date | null;
    annexureOrder: number | null;
    tags: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
  }, document?: {
      id: string;
      originalFilename: string | null;
      contentType: string | null;
      sizeBytes: bigint | null;
      status: string;
      classification: string;
      source: string;
      storageKey?: string;
    } | null
  ) {
    return {
      id: row.id,
      evidence_type: row.evidenceType,
      doc_type: row.docType,
      classification: row.classification,
      sensitivity: row.sensitivity,
      source: row.source,
      document_id: row.documentId,
      file_ref: row.fileRef,
      captured_by_employee_id: row.capturedByEmployeeId,
      captured_at: toIso(row.capturedAt),
      annexure_order: row.annexureOrder,
      tags: row.tags,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      document: document
        ? {
            id: document.id,
            original_filename: document.originalFilename,
            content_type: document.contentType,
            size_bytes: document.sizeBytes === null ? null : Number(document.sizeBytes),
            status: document.status,
            classification: document.classification,
            source: document.source,
            ...(document.storageKey ? { storage_key: document.storageKey } : {})
          }
        : null
    };
  }

  private async loadDocumentsById(
    tx: TxClient,
    documentIds: string[]
  ): Promise<
    Map<
      string,
      {
        id: string;
        originalFilename: string | null;
        contentType: string | null;
        sizeBytes: bigint | null;
        status: string;
        classification: string;
        source: string;
        storageKey?: string;
      }
    >
  > {
    if (documentIds.length === 0) {
      return new Map();
    }

    const docs = await tx.document.findMany({
      where: {
        id: { in: documentIds },
        deletedAt: null
      },
      select: {
        id: true,
        originalFilename: true,
        contentType: true,
        sizeBytes: true,
        status: true,
        classification: true,
        source: true,
        storageKey: true
      }
    });

    return new Map(docs.map((doc) => [doc.id, doc]));
  }

  private serializeComment(row: {
    id: string;
    commentType: string;
    body: string;
    createdByUserId: string | null;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      comment_type: row.commentType,
      body: row.body,
      created_by_user_id: row.createdByUserId,
      created_at: row.createdAt.toISOString()
    };
  }

  private serializeRulesRun(row: {
    id: string;
    rulesetVersion: string;
    warnings: Prisma.JsonValue;
    errors: Prisma.JsonValue;
    createdAt: Date;
    inputSnapshot?: { id: string; version: number } | null;
    outputSnapshot?: { id: string; version: number } | null;
  }) {
    return {
      id: row.id,
      ruleset_version: row.rulesetVersion,
      warnings: row.warnings,
      errors: row.errors,
      created_at: row.createdAt.toISOString(),
      input_snapshot: row.inputSnapshot
        ? {
            id: row.inputSnapshot.id,
            version: row.inputSnapshot.version
          }
        : null,
      output_snapshot: row.outputSnapshot
        ? {
            id: row.outputSnapshot.id,
            version: row.outputSnapshot.version
          }
        : null
    };
  }

  private evidenceListForReadiness(
    rows: Array<{
      evidenceType: string;
      docType: string | null;
      tags: Prisma.JsonValue | null;
    }>
  ): RepogenEvidenceLike[] {
    return rows.map((row) => ({
      evidence_type: row.evidenceType as RepogenEvidenceLike['evidence_type'],
      doc_type: row.docType,
      tags: isRecord(row.tags) ? row.tags : null
    }));
  }

  private latestRulesWarningsToMessages(warningsJson: Prisma.JsonValue | null | undefined): string[] {
    return parseWarningsJson(warningsJson ?? []).map((item) => {
      const code = typeof item.code === 'string' ? item.code : 'RULE_WARNING';
      const message = typeof item.message === 'string' ? item.message : code;
      return `${code}: ${message}`;
    });
  }

  private sortEvidenceRows<T extends { annexureOrder: number | null; createdAt: Date; id: string }>(rows: T[]): T[] {
    return rows.slice().sort((a, b) => {
      const aOrder = a.annexureOrder ?? Number.MAX_SAFE_INTEGER;
      const bOrder = b.annexureOrder ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const byCreated = a.createdAt.getTime() - b.createdAt.getTime();
      if (byCreated !== 0) return byCreated;
      return a.id.localeCompare(b.id);
    });
  }

  private async getWorkOrderOrThrow(tx: TxClient, workOrderId: string) {
    const workOrder = await tx.repogenWorkOrder.findFirst({
      where: { id: workOrderId },
      select: {
        id: true,
        orgId: true,
        sourceType: true,
        sourceRefId: true,
        assignmentId: true,
        reportType: true,
        bankName: true,
        bankType: true,
        valueSlab: true,
        templateSelector: true,
        status: true,
        reportPackId: true,
        evidenceProfileId: true,
        billingModeCache: true,
        billingAccountId: true,
        billingReservationId: true,
        billingServiceInvoiceId: true,
        billingHooksJson: true,
        createdByUserId: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!workOrder) {
      throw new NotFoundException(`repogen work order ${workOrderId} not found`);
    }

    return workOrder;
  }

  private async getLatestSnapshot(tx: TxClient, workOrderId: string): Promise<RepogenSnapshotRow | null> {
    return tx.repogenContractSnapshot.findFirst({
      where: { workOrderId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        contractJson: true,
        derivedJson: true,
        readinessJson: true,
        createdByUserId: true,
        createdAt: true
      }
    });
  }

  private supportsEvidenceIntel(tx: TxClient): boolean {
    const unsafe = tx as unknown as Record<string, unknown>;
    return Boolean(
      unsafe &&
        typeof unsafe === 'object' &&
        (unsafe as any).repogenEvidenceProfile &&
        (unsafe as any).repogenEvidenceProfileItem &&
        (unsafe as any).repogenFieldEvidenceLink
    );
  }

  private async ensureDefaultEvidenceProfileAssigned(
    tx: TxClient,
    workOrder: {
      id: string;
      orgId: string;
      reportType: string;
      bankType: string;
      valueSlab: string;
      evidenceProfileId?: string | null;
    }
  ): Promise<string | null> {
    if (workOrder.evidenceProfileId) {
      return workOrder.evidenceProfileId;
    }
    if (!this.supportsEvidenceIntel(tx)) {
      return null;
    }

    const chosen = await chooseDefaultRepogenEvidenceProfile(tx, {
      id: workOrder.id,
      orgId: workOrder.orgId,
      reportType: workOrder.reportType,
      bankType: workOrder.bankType,
      valueSlab: workOrder.valueSlab
    });

    if (!chosen) {
      return null;
    }

    await tx.repogenWorkOrder.update({
      where: { id: workOrder.id },
      data: { evidenceProfileId: chosen.id }
    });

    return chosen.id;
  }

  private async getEvidenceProfileRequirementsForWorkOrder(
    tx: TxClient,
    workOrder: {
      id: string;
      orgId: string;
      reportType: string;
      bankType: string;
      valueSlab: string;
      evidenceProfileId?: string | null;
    }
  ): Promise<{
    evidenceProfileId: string | null;
    requirements: RepogenEvidenceProfileRequirementLike[];
  }> {
    if (!this.supportsEvidenceIntel(tx)) {
      return { evidenceProfileId: null, requirements: [] };
    }

    const evidenceProfileId = await this.ensureDefaultEvidenceProfileAssigned(tx, workOrder);
    if (!evidenceProfileId) {
      return { evidenceProfileId: null, requirements: [] };
    }

    const profileItems = await tx.repogenEvidenceProfileItem.findMany({
      where: { profileId: evidenceProfileId },
      orderBy: [{ orderHint: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        evidenceType: true,
        docType: true,
        minCount: true,
        isRequired: true,
        tagsJson: true,
        label: true
      }
    });

    return {
      evidenceProfileId,
      requirements: profileItems.map((row) => ({
        id: row.id,
        evidence_type: row.evidenceType as RepogenEvidenceProfileRequirementLike['evidence_type'],
        doc_type: row.docType,
        min_count: row.minCount,
        is_required: row.isRequired,
        tags_json: isRecord(row.tagsJson) ? (row.tagsJson as Record<string, unknown>) : null,
        label: row.label ?? null
      }))
    };
  }

  private async getLinkedFieldKeysForSnapshot(
    tx: TxClient,
    workOrderId: string,
    snapshotId: string | null | undefined
  ): Promise<string[]> {
    if (!snapshotId || !this.supportsEvidenceIntel(tx)) {
      return [];
    }

    const links = await tx.repogenFieldEvidenceLink.findMany({
      where: {
        workOrderId,
        snapshotId
      },
      select: {
        fieldKey: true
      }
    });

    return Array.from(
      new Set(links.map((row) => row.fieldKey).filter((value): value is string => typeof value === 'string' && value.length > 0))
    );
  }

  private async computeCurrentReadiness(
    tx: TxClient,
    workOrder: RepogenWorkOrderRow,
    options?: { latestSnapshot?: RepogenSnapshotRow | null }
  ) {
    const [snapshot, evidenceRows, latestRulesRun, profileReqs] = await Promise.all([
      options?.latestSnapshot !== undefined ? Promise.resolve(options.latestSnapshot) : this.getLatestSnapshot(tx, workOrder.id),
      tx.repogenEvidenceItem.findMany({
        where: { workOrderId: workOrder.id },
        select: {
          id: true,
          evidenceType: true,
          docType: true,
          tags: true,
          annexureOrder: true,
          createdAt: true,
          updatedAt: true,
          classification: true,
          sensitivity: true,
          source: true,
          documentId: true,
          fileRef: true,
          capturedByEmployeeId: true,
          capturedAt: true
        }
      }),
      tx.repogenRulesRun.findFirst({
        where: { workOrderId: workOrder.id },
        orderBy: { createdAt: 'desc' },
        select: {
          warnings: true
        }
      }),
      this.getEvidenceProfileRequirementsForWorkOrder(tx, workOrder)
    ]);

    const contract =
      parseContractJson(snapshot?.contractJson ?? null) ??
      this.baseContractForWorkOrder({
        reportType: workOrder.reportType,
        bankType: workOrder.bankType,
        bankName: workOrder.bankName
      });

    const fieldEvidenceLinkedKeys = await this.getLinkedFieldKeysForSnapshot(tx, workOrder.id, snapshot?.id ?? null);

    const readiness = evaluateRepogenReadiness(
      workOrder.reportType as RepogenContract['meta']['report_type'] extends infer R ? Extract<R, string> : never,
      contract,
      this.evidenceListForReadiness(evidenceRows),
      this.latestRulesWarningsToMessages(latestRulesRun?.warnings),
      {
        evidence_profile_requirements: profileReqs.requirements,
        field_evidence_linked_keys: fieldEvidenceLinkedKeys
      }
    );

    return {
      snapshot,
      contract,
      evidenceRows,
      readiness
    };
  }

  async listWorkOrders(tx: TxClient, query: RepogenWorkOrderListQuery) {
    const where: Prisma.RepogenWorkOrderWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.report_type) where.reportType = query.report_type;
    if (query.bank_type) where.bankType = query.bank_type;
    if (query.template_selector) where.templateSelector = query.template_selector;
    if (query.source_type) where.sourceType = query.source_type;
    if (query.search) {
      where.OR = [
        {
          bankName: {
            contains: query.search,
            mode: 'insensitive'
          }
        },
        {
          id: query.search
        }
      ];
    }

    const rows = await tx.repogenWorkOrder.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: query.limit,
      select: {
        id: true,
        orgId: true,
        sourceType: true,
        sourceRefId: true,
        assignmentId: true,
        reportType: true,
        bankName: true,
        bankType: true,
        valueSlab: true,
        templateSelector: true,
        status: true,
        reportPackId: true,
        evidenceProfileId: true,
        billingModeCache: true,
        billingAccountId: true,
        billingReservationId: true,
        billingServiceInvoiceId: true,
        billingHooksJson: true,
        createdByUserId: true,
        createdAt: true,
        updatedAt: true,
        snapshots: {
          orderBy: { version: 'desc' },
          take: 1,
          select: {
            id: true,
            version: true,
            derivedJson: true,
            readinessJson: true,
            createdAt: true,
            createdByUserId: true,
            contractJson: true
          }
        },
        _count: {
          select: {
            evidenceItems: true,
            comments: true
          }
        }
      }
    });

    return {
      items: rows.map((row) => {
        const latest = row.snapshots[0] ?? null;
        const readiness = parseReadinessJson(latest?.readinessJson ?? null);
        return {
          ...this.serializeWorkOrder(row),
          readiness,
          readiness_score: readiness?.completeness_score ?? null,
          latest_snapshot_version: latest?.version ?? null,
          latest_snapshot_created_at: latest?.createdAt.toISOString() ?? null,
          latest_derived_json: latest?.derivedJson ?? null,
          evidence_count: row._count.evidenceItems,
          comments_count: row._count.comments
        };
      })
    };
  }

  async createWorkOrder(tx: TxClient, orgId: string, actorUserId: string, input: RepogenWorkOrderCreate) {
    const workOrder = await tx.repogenWorkOrder.create({
      data: {
        orgId,
        sourceType: input.source_type,
        sourceRefId: input.source_ref_id,
        assignmentId: input.assignment_id,
        reportType: input.report_type,
        bankName: input.bank_name,
        bankType: input.bank_type ?? 'OTHER',
        createdByUserId: actorUserId,
        billingHooksJson: {}
      },
      select: {
        id: true,
        orgId: true,
        sourceType: true,
        sourceRefId: true,
        assignmentId: true,
        reportType: true,
        bankName: true,
        bankType: true,
        valueSlab: true,
        templateSelector: true,
        status: true,
        reportPackId: true,
        evidenceProfileId: true,
        billingModeCache: true,
        billingAccountId: true,
        billingReservationId: true,
        billingServiceInvoiceId: true,
        billingHooksJson: true,
        createdByUserId: true,
        createdAt: true,
        updatedAt: true
      }
    });

    const evidenceProfileId = await this.ensureDefaultEvidenceProfileAssigned(tx, workOrder);
    if (evidenceProfileId) {
      (workOrder as unknown as { evidenceProfileId: string | null }).evidenceProfileId = evidenceProfileId;
    }

    return {
      work_order_id: workOrder.id,
      work_order: this.serializeWorkOrder(workOrder)
    };
  }

  async getWorkOrderDetail(tx: TxClient, workOrderId: string) {
    const workOrder = await this.getWorkOrderOrThrow(tx, workOrderId);
    const [latestSnapshot, evidenceRows, comments, rulesRuns, profileReqs, fieldEvidenceLinks, ocrJobs] = await Promise.all([
      this.getLatestSnapshot(tx, workOrderId),
      tx.repogenEvidenceItem.findMany({
        where: { workOrderId }
      }),
      tx.repogenComment.findMany({
        where: { workOrderId },
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true,
          commentType: true,
          body: true,
          createdByUserId: true,
          createdAt: true
        }
      }),
      tx.repogenRulesRun.findMany({
        where: { workOrderId },
        orderBy: [{ createdAt: 'desc' }],
        take: 10,
        select: {
          id: true,
          rulesetVersion: true,
          warnings: true,
          errors: true,
          createdAt: true,
          inputSnapshot: {
            select: {
              id: true,
              version: true
            }
          },
          outputSnapshot: {
            select: {
              id: true,
              version: true
            }
          }
        }
      }),
      this.getEvidenceProfileRequirementsForWorkOrder(tx, workOrder),
      this.supportsEvidenceIntel(tx)
        ? tx.repogenFieldEvidenceLink.findMany({
            where: { workOrderId },
            orderBy: [{ createdAt: 'desc' }],
            select: {
              id: true,
              snapshotId: true,
              fieldKey: true,
              evidenceItemId: true,
              confidence: true,
              note: true,
              createdByUserId: true,
              createdAt: true
            }
          })
        : Promise.resolve([]),
      this.supportsEvidenceIntel(tx)
        ? tx.repogenOcrJob.findMany({
            where: { workOrderId },
            orderBy: [{ createdAt: 'desc' }],
            select: {
              id: true,
              evidenceItemId: true,
              status: true,
              requestedAt: true,
              finishedAt: true,
              resultJson: true,
              error: true,
              workerTrace: true,
              createdByUserId: true,
              createdAt: true
            }
          })
        : Promise.resolve([])
    ]);

    const sortedEvidence = this.sortEvidenceRows(evidenceRows);
    const documentMap = await this.loadDocumentsById(
      tx,
      Array.from(
        new Set(
          sortedEvidence
            .map((row) => row.documentId)
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
        )
      )
    );
    const latestRulesWarnings = rulesRuns[0] ? this.latestRulesWarningsToMessages(rulesRuns[0].warnings) : [];
    const contract =
      parseContractJson(latestSnapshot?.contractJson ?? null) ??
      this.baseContractForWorkOrder({
        reportType: workOrder.reportType,
        bankType: workOrder.bankType,
        bankName: workOrder.bankName
      });
    const latestSnapshotLinkedFieldKeys = await this.getLinkedFieldKeysForSnapshot(tx, workOrder.id, latestSnapshot?.id ?? null);
    const readiness = evaluateRepogenReadiness(
      workOrder.reportType as RepogenContract['meta']['report_type'] extends infer R ? Extract<R, string> : never,
      contract,
      this.evidenceListForReadiness(sortedEvidence),
      latestRulesWarnings,
      {
        evidence_profile_requirements: profileReqs.requirements,
        field_evidence_linked_keys: latestSnapshotLinkedFieldKeys
      }
    );

    return {
      work_order: this.serializeWorkOrder(workOrder),
      latest_snapshot: this.serializeSnapshot(latestSnapshot),
      readiness,
      evidence_items: sortedEvidence.map((row) => this.serializeEvidence(row, row.documentId ? documentMap.get(row.documentId) : null)),
      field_evidence_links: fieldEvidenceLinks.map((row) => ({
        id: row.id,
        snapshot_id: row.snapshotId,
        field_key: row.fieldKey,
        evidence_item_id: row.evidenceItemId,
        confidence: row.confidence,
        note: row.note,
        created_by_user_id: row.createdByUserId,
        created_at: row.createdAt.toISOString()
      })),
      ocr_jobs: ocrJobs.map((row) => ({
        id: row.id,
        evidence_item_id: row.evidenceItemId,
        status: row.status,
        requested_at: row.requestedAt.toISOString(),
        finished_at: toIso(row.finishedAt),
        result_json: row.resultJson,
        error: row.error,
        worker_trace: row.workerTrace,
        created_by_user_id: row.createdByUserId,
        created_at: row.createdAt.toISOString()
      })),
      comments: comments.map((row) => this.serializeComment(row)),
      rules_runs: rulesRuns.map((row) => this.serializeRulesRun(row))
    };
  }

  async patchContract(
    tx: TxClient,
    workOrderId: string,
    actorUserId: string,
    input: RepogenContractPatchRequest
  ) {
    const workOrder = await this.getWorkOrderOrThrow(tx, workOrderId);
    const latestSnapshot = await this.getLatestSnapshot(tx, workOrderId);

    const baseContract =
      parseContractJson(latestSnapshot?.contractJson ?? null) ??
      this.baseContractForWorkOrder({
        reportType: workOrder.reportType,
        bankType: workOrder.bankType,
        bankName: workOrder.bankName
      });

    const mergedRaw = deepMerge(baseContract, input.patch);
    if (!isRecord(mergedRaw)) {
      throw new BadRequestException('INVALID_CONTRACT_PATCH');
    }

    const mergedCandidate = cloneJson(mergedRaw);
    if (!isRecord(mergedCandidate.meta)) mergedCandidate.meta = {};
    if (!isRecord(mergedCandidate.party)) mergedCandidate.party = {};
    (mergedCandidate.meta as Record<string, unknown>).report_type = workOrder.reportType;
    (mergedCandidate.meta as Record<string, unknown>).bank_type = workOrder.bankType;
    if (!((mergedCandidate.party as Record<string, unknown>).bank_name)) {
      (mergedCandidate.party as Record<string, unknown>).bank_name = workOrder.bankName;
    }

    const parsedMerged = RepogenContractSchema.safeParse(mergedCandidate);
    if (!parsedMerged.success) {
      throw new BadRequestException(parsedMerged.error);
    }

    const canonicalInputContract = parsedMerged.data;
    const nextInputVersion = (latestSnapshot?.version ?? 0) + 1;
    const nextOutputVersion = nextInputVersion + 1;
    const nowIso = new Date().toISOString();

    const inputSnapshotContract = cloneJson(canonicalInputContract);
    inputSnapshotContract.audit.snapshot_version = nextInputVersion;
    inputSnapshotContract.audit.created_by = actorUserId;
    inputSnapshotContract.audit.created_at = nowIso;

    const inputSnapshot = await tx.repogenContractSnapshot.create({
      data: {
        orgId: workOrder.orgId,
        workOrderId: workOrder.id,
        version: nextInputVersion,
        contractJson: toJsonValue(inputSnapshotContract),
        derivedJson: toJsonValue({}),
        readinessJson: toJsonValue({
          completeness_score: 0,
          missing_fields: [],
          missing_evidence: [],
          warnings: [],
          required_evidence_minimums: {}
        }),
        createdByUserId: actorUserId
      },
      select: {
        id: true,
        version: true,
        contractJson: true,
        derivedJson: true,
        readinessJson: true,
        createdByUserId: true,
        createdAt: true
      }
    });

    const evidenceRows = await tx.repogenEvidenceItem.findMany({
      where: { workOrderId: workOrder.id },
      select: {
        evidenceType: true,
        docType: true,
        tags: true,
        annexureOrder: true,
        createdAt: true,
        updatedAt: true,
        id: true,
        classification: true,
        sensitivity: true,
        source: true,
        documentId: true,
        fileRef: true,
        capturedByEmployeeId: true,
        capturedAt: true
      }
    });
    const profileReqs = await this.getEvidenceProfileRequirementsForWorkOrder(tx, workOrder);

    const rulesResult = computeRepogenContract(canonicalInputContract, input.ruleset_version);
    const outputContract = cloneJson(rulesResult.contract);
    outputContract.meta.report_type = workOrder.reportType as RepogenContract['meta']['report_type'];
    outputContract.meta.bank_type = (outputContract.meta.bank_type ?? workOrder.bankType) as RepogenContract['meta']['bank_type'];
    outputContract.party.bank_name = outputContract.party.bank_name ?? workOrder.bankName;
    outputContract.audit.snapshot_version = nextOutputVersion;
    outputContract.audit.created_by = actorUserId;
    outputContract.audit.created_at = nowIso;

    const readiness = evaluateRepogenReadiness(
      workOrder.reportType as RepogenContract['meta']['report_type'] extends infer R ? Extract<R, string> : never,
      outputContract,
      this.evidenceListForReadiness(evidenceRows),
      rulesResult.warnings.map((warning) => `${warning.code}: ${warning.message}`),
      {
        evidence_profile_requirements: profileReqs.requirements,
        field_evidence_linked_keys: []
      }
    );

    const outputSnapshot = await tx.repogenContractSnapshot.create({
      data: {
        orgId: workOrder.orgId,
        workOrderId: workOrder.id,
        version: nextOutputVersion,
        contractJson: toJsonValue(outputContract),
        derivedJson: toJsonValue(rulesResult.derived),
        readinessJson: toJsonValue(readiness),
        createdByUserId: actorUserId
      },
      select: {
        id: true,
        version: true,
        contractJson: true,
        derivedJson: true,
        readinessJson: true,
        createdByUserId: true,
        createdAt: true
      }
    });

    const rulesRun = await tx.repogenRulesRun.create({
      data: {
        orgId: workOrder.orgId,
        workOrderId: workOrder.id,
        inputSnapshotId: inputSnapshot.id,
        outputSnapshotId: outputSnapshot.id,
        rulesetVersion: rulesResult.ruleset_version,
        warnings: toJsonValue(rulesResult.warnings),
        errors: toJsonValue(rulesResult.errors)
      },
      select: {
        id: true,
        rulesetVersion: true,
        warnings: true,
        errors: true,
        createdAt: true,
        inputSnapshot: {
          select: {
            id: true,
            version: true
          }
        },
        outputSnapshot: {
          select: {
            id: true,
            version: true
          }
        }
      }
    });

    await tx.repogenWorkOrder.update({
      where: { id: workOrder.id },
      data: {
        bankType: (outputContract.meta.bank_type ?? workOrder.bankType) as any,
        valueSlab: (outputContract.meta.value_slab ?? workOrder.valueSlab) as any,
        templateSelector: (outputContract.meta.template_selector ?? workOrder.templateSelector) as any
      }
    });

    if (!workOrder.evidenceProfileId) {
      await this.ensureDefaultEvidenceProfileAssigned(tx, {
        ...workOrder,
        bankType: String(outputContract.meta.bank_type ?? workOrder.bankType),
        valueSlab: String(outputContract.meta.value_slab ?? workOrder.valueSlab)
      });
    }

    return {
      work_order_id: workOrder.id,
      input_snapshot: this.serializeSnapshot(inputSnapshot),
      output_snapshot: this.serializeSnapshot(outputSnapshot),
      readiness,
      rules_run: this.serializeRulesRun(rulesRun)
    };
  }

  async upsertEvidenceLinks(
    tx: TxClient,
    workOrderId: string,
    actorUserId: string,
    input: RepogenEvidenceLinkRequest
  ) {
    const workOrder = await this.getWorkOrderOrThrow(tx, workOrderId);

    const documentIds = Array.from(
      new Set(
        input.items
          .map((item) => item.document_id)
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
      )
    );

    if (documentIds.length > 0) {
      const existingDocs = await tx.document.findMany({
        where: {
          id: { in: documentIds },
          deletedAt: null
        },
        select: { id: true }
      });
      const foundIds = new Set(existingDocs.map((doc) => doc.id));
      const missingIds = documentIds.filter((id) => !foundIds.has(id));
      if (missingIds.length > 0) {
        throw new BadRequestException(`document(s) not found or not visible: ${missingIds.join(', ')}`);
      }
    }

    for (const item of input.items) {
      const baseData = {
        evidenceType: item.evidence_type,
        docType: item.doc_type ?? null,
        classification: item.classification ?? null,
        sensitivity: item.sensitivity ?? null,
        source: item.source ?? null,
        documentId: item.document_id ?? null,
        fileRef: item.file_ref ?? null,
        capturedByEmployeeId: item.captured_by_employee_id ?? null,
        capturedAt: item.captured_at ? new Date(item.captured_at) : null,
        annexureOrder: item.annexure_order ?? null,
        tags: item.tags ? toJsonValue(item.tags) : Prisma.JsonNull
      };

      if (item.id) {
        const existing = await tx.repogenEvidenceItem.findFirst({
          where: {
            id: item.id,
            workOrderId: workOrder.id
          },
          select: { id: true }
        });
        if (!existing) {
          throw new NotFoundException(`repogen evidence item ${item.id} not found`);
        }

        await tx.repogenEvidenceItem.update({
          where: { id: existing.id },
          data: baseData
        });
        continue;
      }

      await tx.repogenEvidenceItem.create({
        data: {
          orgId: workOrder.orgId,
          workOrderId: workOrder.id,
          ...baseData
        }
      });
    }

    const detail = await this.getWorkOrderDetail(tx, workOrderId);
    return {
      work_order_id: workOrderId,
      readiness: detail.readiness,
      evidence_items: detail.evidence_items
    };
  }

  async listComments(tx: TxClient, workOrderId: string) {
    await this.getWorkOrderOrThrow(tx, workOrderId);
    const rows = await tx.repogenComment.findMany({
      where: { workOrderId },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        commentType: true,
        body: true,
        createdByUserId: true,
        createdAt: true
      }
    });
    return {
      items: rows.map((row) => this.serializeComment(row))
    };
  }

  async createComment(tx: TxClient, workOrderId: string, actorUserId: string, input: RepogenCommentCreate) {
    const workOrder = await this.getWorkOrderOrThrow(tx, workOrderId);
    const row = await tx.repogenComment.create({
      data: {
        orgId: workOrder.orgId,
        workOrderId: workOrder.id,
        commentType: input.comment_type,
        body: input.body,
        createdByUserId: actorUserId
      },
      select: {
        id: true,
        commentType: true,
        body: true,
        createdByUserId: true,
        createdAt: true
      }
    });
    return this.serializeComment(row);
  }

  async exportWorkOrder(tx: TxClient, workOrderId: string, query: RepogenExportQuery) {
    const workOrder = await this.getWorkOrderOrThrow(tx, workOrderId);
    const snapshot = query.snapshot_version
      ? await tx.repogenContractSnapshot.findFirst({
          where: {
            workOrderId,
            version: query.snapshot_version
          },
          select: {
            id: true,
            version: true,
            contractJson: true,
            derivedJson: true,
            readinessJson: true,
            createdByUserId: true,
            createdAt: true
          }
        })
      : await this.getLatestSnapshot(tx, workOrderId);

    if (!snapshot) {
      throw new NotFoundException(
        query.snapshot_version
          ? `repogen snapshot v${query.snapshot_version} not found`
          : 'repogen snapshot not found for work order'
      );
    }

    const evidenceRows = this.sortEvidenceRows(
      await tx.repogenEvidenceItem.findMany({
        where: { workOrderId }
      })
    );
    const documentMap = await this.loadDocumentsById(
      tx,
      Array.from(
        new Set(
          evidenceRows
            .map((row) => row.documentId)
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
        )
      )
    );

    const contract = parseContractJson(snapshot.contractJson);
    if (!contract) {
      throw new ConflictException(`snapshot ${snapshot.id} has invalid contract_json`);
    }

    const annexureHintsByEvidenceId = new Map(
      (contract.annexures.items ?? []).map((item) => [
        item.evidence_item_id,
        {
          label: item.label ?? null,
          category: item.category ?? null,
          sort_order: item.sort_order,
          group_hint: item.group_hint ?? null
        }
      ])
    );

    const evidenceManifest = evidenceRows.map((row) => {
      const doc = row.documentId ? documentMap.get(row.documentId) ?? null : null;
      return {
        id: row.id,
        evidence_type: row.evidenceType,
        doc_type: row.docType,
        annexure_order: row.annexureOrder,
        classification: row.classification,
        sensitivity: row.sensitivity,
        source: row.source,
        document_id: row.documentId,
        file_ref: row.fileRef,
        captured_by_employee_id: row.capturedByEmployeeId,
        captured_at: toIso(row.capturedAt),
        tags: row.tags,
        created_at: row.createdAt.toISOString(),
        document: doc
          ? {
              id: doc.id,
              original_filename: doc.originalFilename,
              content_type: doc.contentType,
              size_bytes: doc.sizeBytes === null ? null : Number(doc.sizeBytes),
              status: doc.status,
              classification: doc.classification,
              source: doc.source,
              storage_key: doc.storageKey ?? null
            }
          : null,
        annexure_hint: annexureHintsByEvidenceId.get(row.id) ?? null
      };
    });

    return {
      work_order: this.serializeWorkOrder(workOrder),
      snapshot: this.serializeSnapshot(snapshot),
      export_bundle: {
        work_order_id: workOrder.id,
        snapshot_version: snapshot.version,
        contract_json: snapshot.contractJson,
        derived_json: snapshot.derivedJson,
        readiness_json: snapshot.readinessJson,
        annexure_defaults: contract.annexures.image_grouping_default,
        evidence_manifest: evidenceManifest
      }
    };
  }

  async transitionStatus(
    tx: TxClient,
    workOrderId: string,
    actorUserId: string,
    input: RepogenStatusTransition
  ) {
    const workOrder = await this.getWorkOrderOrThrow(tx, workOrderId);

    if (workOrder.status === input.status) {
      return this.getWorkOrderDetail(tx, workOrderId);
    }

    const allowed = ALLOWED_TRANSITIONS[workOrder.status as RepogenWorkOrderStatus] ?? [];
    if (!allowed.includes(input.status)) {
      throw new BadRequestException(`invalid status transition ${workOrder.status} -> ${input.status}`);
    }

    const latestSnapshot = await this.getLatestSnapshot(tx, workOrderId);
    const { readiness } = await this.computeCurrentReadiness(tx, workOrder, { latestSnapshot });

    if (input.status === 'READY_FOR_RENDER') {
      if (!latestSnapshot) {
        throw new BadRequestException('READY_FOR_RENDER requires at least one computed contract snapshot');
      }
      if (readinessBlocksStatus(readiness)) {
        throw new BadRequestException({
          code: 'REPOGEN_READINESS_BLOCK',
          message: 'READY_FOR_RENDER blocked by missing fields/evidence',
          readiness
        });
      }
    }

    let nextBillingModeCache = workOrder.billingModeCache;
    let nextBillingAccountId = workOrder.billingAccountId;
    let nextBillingReservationId = workOrder.billingReservationId;
    let nextBillingServiceInvoiceId = workOrder.billingServiceInvoiceId;
    const billingHooks = isRecord(workOrder.billingHooksJson) ? cloneJson(workOrder.billingHooksJson) : {};

    if (input.status === 'DATA_PENDING' && workOrder.status !== 'DATA_PENDING') {
      const acceptanceBilling = await this.billingControlService.ensureRepogenAcceptanceBilling(tx, {
        tenant_id: workOrder.orgId,
        repogen_work_order_id: workOrder.id,
        assignment_id: workOrder.assignmentId,
        report_type: workOrder.reportType as 'VALUATION' | 'DPR' | 'REVALUATION' | 'STAGE_PROGRESS',
        bank_name: workOrder.bankName
      });

      nextBillingModeCache = acceptanceBilling.mode;
      nextBillingAccountId = acceptanceBilling.account_id;
      nextBillingReservationId = acceptanceBilling.reservation_id;
      nextBillingServiceInvoiceId = acceptanceBilling.service_invoice_id;
      billingHooks.acceptance_billed_at = new Date().toISOString();
      billingHooks.acceptance_billing_mode = acceptanceBilling.mode;
    }

    if (input.status === 'READY_FOR_RENDER' && nextBillingAccountId) {
      await this.billingControlService.ingestUsageEvent(tx, {
        source_system: 'v2',
        event_type: 'repogen_ready_for_render_planned',
        account_id: nextBillingAccountId,
        payload_json: {
          repogen_work_order_id: workOrder.id,
          assignment_id: workOrder.assignmentId,
          snapshot_version: latestSnapshot?.version ?? null,
          readiness_score: readiness.completeness_score
        },
        idempotency_key: `v2:repogen_ready_for_render_planned:${workOrder.id}`
      });
      billingHooks.planned_consumption_logged_at = new Date().toISOString();
    }

    await tx.repogenWorkOrder.update({
      where: { id: workOrder.id },
      data: {
        status: input.status,
        billingModeCache: nextBillingModeCache,
        billingAccountId: nextBillingAccountId,
        billingReservationId: nextBillingReservationId,
        billingServiceInvoiceId: nextBillingServiceInvoiceId,
        billingHooksJson: toJsonValue(billingHooks)
      }
    });

    await tx.repogenComment.create({
      data: {
        orgId: workOrder.orgId,
        workOrderId: workOrder.id,
        commentType: 'NOTES',
        body: input.note
          ? `Status changed: ${workOrder.status} -> ${input.status}\n${input.note}`
          : `Status changed: ${workOrder.status} -> ${input.status}`,
        createdByUserId: actorUserId
      }
    });

    return this.getWorkOrderDetail(tx, workOrderId);
  }
}
