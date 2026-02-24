import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  RepogenDraftContextQuery,
  RepogenDraftUpsert,
  RepogenEvidenceLinksUpsert,
  RepogenGenerateTrigger,
  RepogenPacksListQuery
} from '@zenops/contracts';
import { Prisma, type TxClient } from '@zenops/db';

type WarningSeverity = 'info' | 'warn' | 'error';

export interface RepogenWarning {
  code: string;
  severity: WarningSeverity;
  message: string;
  field_key?: string;
  section_key?: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const jsonObject = (value: Record<string, unknown> | undefined): Prisma.InputJsonObject | undefined =>
  value ? (value as unknown as Prisma.InputJsonObject) : undefined;

const jsonArray = (value: unknown[]): Prisma.InputJsonArray => value as unknown as Prisma.InputJsonArray;

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const firstString = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
};

@Injectable()
export class RepogenService {
  private readonly supportedTemplates = {
    SBI_UNDER_5CR_V1: {
      family: 'valuation' as const,
      label: 'SBI Valuation (Under 5Cr) v1',
      requiredFieldKeys: [
        'property.address',
        'inspection_date',
        'assignment_date',
        'guideline_value_total',
        'land_value',
        'building_value',
        'building.age_years',
        'building.total_life_years'
      ],
      evidenceSections: [
        'guideline_screenshot',
        'gps_photos',
        'site_photos',
        'google_map',
        'route_map'
      ]
    }
  } as const;

  private async getAssignment(tx: TxClient, assignmentId: string) {
    const assignment = await tx.assignment.findFirst({
      where: {
        id: assignmentId,
        deletedAt: null
      },
      select: {
        id: true,
        tenantId: true,
        title: true,
        status: true,
        stage: true
      }
    });

    if (!assignment) {
      throw new NotFoundException(`assignment ${assignmentId} not found`);
    }

    return assignment;
  }

  private async ensureTemplateVersion(
    tx: TxClient,
    tenantId: string,
    templateKey: keyof RepogenService['supportedTemplates'],
    version: number,
    reportFamily: 'valuation' | 'dpr' | 'stage_progress' | 'tev' | 'annexure'
  ) {
    let template = await tx.reportTemplate.findFirst({
      where: {
        tenantId,
        templateKey,
        deletedAt: null
      }
    });

    if (!template) {
      template = await tx.reportTemplate.create({
        data: {
          tenantId,
          name: this.supportedTemplates[templateKey].label,
          templateKey,
          family: reportFamily,
          status: 'active',
          metadataJson: {
            repogen: true,
            scope: 'm5.3_phase_1'
          }
        }
      });
    } else if (template.family !== reportFamily || template.status !== 'active') {
      template = await tx.reportTemplate.update({
        where: { id: template.id },
        data: {
          family: reportFamily,
          status: 'active'
        }
      });
    }

    let templateVersion = await tx.templateVersion.findFirst({
      where: {
        tenantId,
        reportTemplateId: template.id,
        version,
        deletedAt: null
      }
    });

    if (!templateVersion) {
      templateVersion = await tx.templateVersion.create({
        data: {
          tenantId,
          reportTemplateId: template.id,
          version,
          label: `${templateKey} v${version}`,
          status: 'active',
          storageRef: `repogen://templates/${templateKey}/v${version}`,
          manifestJson: {
            template_key: templateKey,
            version,
            report_family: reportFamily,
            placeholder: true
          }
        }
      });
    }

    return {
      template,
      templateVersion
    };
  }

  private normalizeSectionKey(sectionKey: string | undefined): string {
    return sectionKey?.trim() ?? '';
  }

  private parseWarningsJson(value: Prisma.JsonValue): RepogenWarning[] {
    if (!Array.isArray(value)) return [];
    const warnings: RepogenWarning[] = [];
    for (const raw of value) {
      if (!isRecord(raw) || typeof raw.code !== 'string') {
        continue;
      }
      warnings.push({
        code: raw.code,
        severity:
          raw.severity === 'error' || raw.severity === 'info' || raw.severity === 'warn'
            ? raw.severity
            : 'warn',
        message: typeof raw.message === 'string' ? raw.message : raw.code,
        field_key: typeof raw.field_key === 'string' ? raw.field_key : undefined,
        section_key: typeof raw.section_key === 'string' ? raw.section_key : undefined
      });
    }
    return warnings;
  }

  private buildWarnings(
    templateKey: keyof RepogenService['supportedTemplates'],
    fields: Array<{
      fieldKey: string;
      sectionKey: string;
      valueJson: Prisma.JsonValue;
      ocrJson: Prisma.JsonValue | null;
    }>,
    evidenceLinks: Array<{
      fieldKey: string | null;
      sectionKey: string;
      ocrJson: Prisma.JsonValue | null;
    }>
  ): RepogenWarning[] {
    const template = this.supportedTemplates[templateKey];
    const warnings: RepogenWarning[] = [];

    const fieldMap = new Map<string, Prisma.JsonValue>();
    for (const row of fields) {
      const key = row.sectionKey ? `${row.sectionKey}.${row.fieldKey}` : row.fieldKey;
      fieldMap.set(key, row.valueJson);
      fieldMap.set(row.fieldKey, row.valueJson);
      if (row.ocrJson && isRecord(row.ocrJson) && row.ocrJson.status === 'failed') {
        warnings.push({
          code: 'OCR_FIELD_FAILED',
          severity: 'warn',
          message: `OCR placeholder failed for field ${row.fieldKey}. Manual review required.`,
          field_key: row.fieldKey,
          section_key: row.sectionKey || null
        });
      }
    }

    for (const fieldKey of template.requiredFieldKeys) {
      const raw = fieldMap.get(fieldKey);
      const missing =
        raw === undefined ||
        raw === null ||
        (typeof raw === 'string' && raw.trim().length === 0) ||
        (Array.isArray(raw) && raw.length === 0);
      if (missing) {
        warnings.push({
          code: 'MISSING_REQUIRED_FIELD',
          severity: 'warn',
          message: `Missing required draft field: ${fieldKey}`,
          field_key: fieldKey
        });
      }
    }

    const evidenceSectionsPresent = new Set(
      evidenceLinks.map((row) => row.sectionKey).filter((value) => value.length > 0)
    );
    for (const sectionKey of template.evidenceSections) {
      if (!evidenceSectionsPresent.has(sectionKey)) {
        warnings.push({
          code: 'MISSING_EVIDENCE_SECTION',
          severity: 'warn',
          message: `Missing evidence attachment for ${sectionKey}`,
          section_key: sectionKey
        });
      }
    }

    for (const link of evidenceLinks) {
      if (link.ocrJson && isRecord(link.ocrJson)) {
        const status = typeof link.ocrJson.status === 'string' ? link.ocrJson.status : '';
        if (status === 'pending') {
          warnings.push({
            code: 'OCR_EVIDENCE_PENDING',
            severity: 'info',
            message: `OCR placeholder pending for evidence ${link.sectionKey || link.fieldKey || 'link'}`,
            section_key: link.sectionKey || null,
            field_key: link.fieldKey ?? undefined
          });
        }
        if (status === 'failed') {
          warnings.push({
            code: 'OCR_EVIDENCE_FAILED',
            severity: 'warn',
            message: `OCR placeholder failed for evidence ${link.sectionKey || link.fieldKey || 'link'}`,
            section_key: link.sectionKey || null,
            field_key: link.fieldKey ?? undefined
          });
        }
      }
    }

    const landValue = toNumber(fieldMap.get('land_value'));
    const buildingValue = toNumber(fieldMap.get('building_value'));
    if (landValue !== null && buildingValue !== null) {
      const fmv = landValue + buildingValue;
      const guideline = toNumber(fieldMap.get('guideline_value_total'));
      if (guideline !== null && guideline > 0) {
        const variancePct = Math.abs(fmv - guideline) / guideline;
        if (variancePct >= 0.2) {
          warnings.push({
            code: 'FMV_GUIDELINE_VARIANCE',
            severity: 'warn',
            message: 'FMV and guideline value variance is 20% or more. Add manual justification if needed.'
          });
        }
      }
    }

    return warnings;
  }

  private async appendAuditLog(
    tx: TxClient,
    input: {
      tenantId: string;
      assignmentId: string;
      actorUserId?: string | null;
      reportGenerationJobId?: string | null;
      reportPackId?: string | null;
      fieldValueId?: string | null;
      evidenceLinkId?: string | null;
      action: string;
      entityType: string;
      entityId?: string | null;
      beforeJson?: Record<string, unknown> | null;
      afterJson?: Record<string, unknown> | null;
      metadataJson?: Record<string, unknown>;
    }
  ) {
    await tx.reportAuditLog.create({
      data: {
        tenantId: input.tenantId,
        assignmentId: input.assignmentId,
        actorUserId: input.actorUserId ?? null,
        reportGenerationJobId: input.reportGenerationJobId ?? null,
        reportPackId: input.reportPackId ?? null,
        fieldValueId: input.fieldValueId ?? null,
        evidenceLinkId: input.evidenceLinkId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        beforeJson: input.beforeJson ? (input.beforeJson as unknown as Prisma.InputJsonObject) : undefined,
        afterJson: input.afterJson ? (input.afterJson as unknown as Prisma.InputJsonObject) : undefined,
        metadataJson: (input.metadataJson ?? {}) as unknown as Prisma.InputJsonObject
      }
    });
  }

  private serializeField(row: {
    id: string;
    sectionKey: string;
    fieldKey: string;
    source: string;
    valueJson: Prisma.JsonValue;
    normalizedText: string | null;
    sourceDocumentId: string | null;
    ocrJson: Prisma.JsonValue | null;
    derivedFromJson: Prisma.JsonValue | null;
    updatedByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      section_key: row.sectionKey || null,
      field_key: row.fieldKey,
      source: row.source,
      value: row.valueJson,
      normalized_text: row.normalizedText,
      source_document_id: row.sourceDocumentId,
      ocr: row.ocrJson,
      derived_from: row.derivedFromJson,
      updated_by_user_id: row.updatedByUserId,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  private serializeEvidenceLink(row: {
    id: string;
    sectionKey: string;
    fieldKey: string | null;
    label: string | null;
    sortOrder: number;
    metadataJson: Prisma.JsonValue;
    ocrJson: Prisma.JsonValue | null;
    createdByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
    document: {
      id: string;
      originalFilename: string | null;
      contentType: string | null;
      sizeBytes: bigint | null;
      status: string;
      classification: string;
      source: string;
      storageKey: string;
    };
  }) {
    return {
      id: row.id,
      section_key: row.sectionKey || null,
      field_key: row.fieldKey,
      label: row.label,
      sort_order: row.sortOrder,
      metadata_json: row.metadataJson,
      ocr: row.ocrJson,
      created_by_user_id: row.createdByUserId,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      document: {
        id: row.document.id,
        original_filename: row.document.originalFilename,
        content_type: row.document.contentType,
        size_bytes: row.document.sizeBytes === null ? null : Number(row.document.sizeBytes),
        status: row.document.status,
        classification: row.document.classification,
        source: row.document.source,
        storage_key: row.document.storageKey,
        presign_download_endpoint: `/v1/files/${row.document.id}/presign-download`
      }
    };
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
      metadata_json: row.metadataJson,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  private serializePack(row: {
    id: string;
    templateKey: string;
    reportFamily: string;
    version: number;
    status: string;
    createdByUserId: string | null;
    warningsJson: Prisma.JsonValue;
    contextSnapshotJson: Prisma.JsonValue | null;
    generatedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    templateVersion: { id: string; version: number; label: string | null } | null;
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
      template_key: row.templateKey,
      report_family: row.reportFamily,
      version: row.version,
      status: row.status,
      created_by_user_id: row.createdByUserId,
      warnings: this.parseWarningsJson(row.warningsJson),
      context_snapshot: row.contextSnapshotJson,
      generated_at: row.generatedAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      template_version: row.templateVersion
        ? {
            id: row.templateVersion.id,
            version: row.templateVersion.version,
            label: row.templateVersion.label
          }
        : null,
      artifacts: row.artifacts.map((artifact) => this.serializeArtifact(artifact))
    };
  }

  private serializeJob(row: {
    id: string;
    assignmentId: string;
    templateKey: string;
    reportFamily: string;
    idempotencyKey: string;
    status: string;
    attempts: number;
    errorMessage: string | null;
    workerTrace: string | null;
    requestedByUserId: string | null;
    requestPayloadJson: Prisma.JsonValue;
    warningsJson: Prisma.JsonValue;
    queuedAt: Date | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    templateVersion: { id: string; version: number; label: string | null } | null;
    reportPack: {
      id: string;
      templateKey: string;
      reportFamily: string;
      version: number;
      status: string;
      createdByUserId: string | null;
      warningsJson: Prisma.JsonValue;
      contextSnapshotJson: Prisma.JsonValue | null;
      generatedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      templateVersion: { id: string; version: number; label: string | null } | null;
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
    } | null;
  }) {
    return {
      id: row.id,
      assignment_id: row.assignmentId,
      template_key: row.templateKey,
      report_family: row.reportFamily,
      idempotency_key: row.idempotencyKey,
      status: row.status,
      attempts: row.attempts,
      error_message: row.errorMessage,
      worker_trace: row.workerTrace,
      requested_by_user_id: row.requestedByUserId,
      request_payload: row.requestPayloadJson,
      warnings: this.parseWarningsJson(row.warningsJson),
      queued_at: row.queuedAt?.toISOString() ?? null,
      started_at: row.startedAt?.toISOString() ?? null,
      finished_at: row.finishedAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      template_version: row.templateVersion
        ? {
            id: row.templateVersion.id,
            version: row.templateVersion.version,
            label: row.templateVersion.label
          }
        : null,
      report_pack: row.reportPack ? this.serializePack(row.reportPack) : null
    };
  }

  async getDraftContext(tx: TxClient, assignmentId: string, query: RepogenDraftContextQuery) {
    const assignment = await this.getAssignment(tx, assignmentId);
    const templateKey = query.template_key as keyof RepogenService['supportedTemplates'];
    const templateMeta = await tx.reportTemplate.findFirst({
      where: {
        tenantId: assignment.tenantId,
        templateKey,
        deletedAt: null
      },
      include: {
        versions: {
          where: { deletedAt: null, status: 'active' },
          orderBy: { version: 'desc' },
          take: 5,
          select: {
            id: true,
            version: true,
            label: true,
            status: true,
            storageRef: true
          }
        }
      }
    });

    const [fieldRows, evidenceRows, latestJob, auditRows] = await Promise.all([
      tx.reportFieldValue.findMany({
        where: {
          tenantId: assignment.tenantId,
          assignmentId,
          templateKey
        },
        orderBy: [{ sectionKey: 'asc' }, { fieldKey: 'asc' }]
      }),
      tx.reportEvidenceLink.findMany({
        where: {
          tenantId: assignment.tenantId,
          assignmentId,
          templateKey
        },
        include: {
          document: {
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
          }
        },
        orderBy: [{ sectionKey: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }]
      }),
      tx.reportGenerationJob.findFirst({
        where: {
          tenantId: assignment.tenantId,
          assignmentId,
          templateKey
        },
        include: {
          templateVersion: {
            select: { id: true, version: true, label: true }
          },
          reportPack: {
            include: {
              templateVersion: { select: { id: true, version: true, label: true } },
              artifacts: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      tx.reportAuditLog.findMany({
        where: {
          tenantId: assignment.tenantId,
          assignmentId
        },
        orderBy: { createdAt: 'desc' },
        take: 30
      })
    ]);

    const warnings = this.buildWarnings(
      templateKey,
      fieldRows.map((row) => ({
        fieldKey: row.fieldKey,
        sectionKey: row.sectionKey,
        valueJson: row.valueJson,
        ocrJson: row.ocrJson
      })),
      evidenceRows.map((row) => ({
        fieldKey: row.fieldKey,
        sectionKey: row.sectionKey,
        ocrJson: row.ocrJson
      }))
    );

    const fieldMap = new Map(
      fieldRows.map((row) => [
        row.sectionKey ? `${row.sectionKey}.${row.fieldKey}` : row.fieldKey,
        row.valueJson
      ])
    );
    const landValue = toNumber(fieldMap.get('land_value'));
    const buildingValue = toNumber(fieldMap.get('building_value'));
    const guidelineValue = toNumber(fieldMap.get('guideline_value_total'));
    const ageYears = toNumber(fieldMap.get('building.age_years') ?? fieldMap.get('age_years'));
    const totalLifeYears = toNumber(fieldMap.get('building.total_life_years') ?? fieldMap.get('total_life_years'));
    const computed =
      landValue !== null && buildingValue !== null
        ? {
            fmv: landValue + buildingValue,
            realizable: Math.round((landValue + buildingValue) * 0.95),
            distress: Math.round((landValue + buildingValue) * 0.8),
            book_value: guidelineValue,
            depreciation_pct:
              ageYears !== null && totalLifeYears && totalLifeYears > 0
                ? Number((((ageYears / totalLifeYears) * 100)).toFixed(2))
                : null
          }
        : null;

    return {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        status: assignment.status,
        stage: assignment.stage
      },
      template: {
        key: templateKey,
        family: this.supportedTemplates[templateKey].family,
        registry: templateMeta
          ? {
              template_id: templateMeta.id,
              status: templateMeta.status,
              versions: templateMeta.versions.map((versionRow) => ({
                id: versionRow.id,
                version: versionRow.version,
                label: versionRow.label,
                status: versionRow.status,
                storage_ref: versionRow.storageRef
              }))
            }
          : null
      },
      fields: fieldRows.map((row) => this.serializeField(row)),
      evidence_links: evidenceRows.map((row) => this.serializeEvidenceLink(row)),
      warnings,
      computed_preview: computed,
      latest_job: latestJob ? this.serializeJob(latestJob) : null,
      audit_timeline: auditRows.map((row) => ({
        id: row.id,
        action: row.action,
        entity_type: row.entityType,
        entity_id: row.entityId,
        actor_user_id: row.actorUserId,
        report_generation_job_id: row.reportGenerationJobId,
        report_pack_id: row.reportPackId,
        field_value_id: row.fieldValueId,
        evidence_link_id: row.evidenceLinkId,
        before_json: row.beforeJson,
        after_json: row.afterJson,
        metadata_json: row.metadataJson,
        created_at: row.createdAt.toISOString()
      }))
    };
  }

  async upsertDraftFields(
    tx: TxClient,
    assignmentId: string,
    actorUserId: string | null,
    input: RepogenDraftUpsert
  ) {
    const assignment = await this.getAssignment(tx, assignmentId);
    const templateKey = input.template_key as keyof RepogenService['supportedTemplates'];
    if (!(templateKey in this.supportedTemplates)) {
      throw new BadRequestException(`Unsupported template_key ${input.template_key}`);
    }

    await this.ensureTemplateVersion(tx, assignment.tenantId, templateKey, 1, input.report_family);

    const uniqueTargets = Array.from(
      new Set(input.fields.map((field) => `${this.normalizeSectionKey(field.section_key)}::${field.field_key}`))
    ).map((value) => {
      const [sectionKey, fieldKey] = value.split('::');
      return { sectionKey, fieldKey };
    });

    const existingRows = await tx.reportFieldValue.findMany({
      where: {
        tenantId: assignment.tenantId,
        assignmentId,
        templateKey,
        OR: uniqueTargets.map((target) => ({
          sectionKey: target.sectionKey,
          fieldKey: target.fieldKey
        }))
      }
    });
    const existingByKey = new Map(existingRows.map((row) => [`${row.sectionKey}::${row.fieldKey}`, row]));

    for (const field of input.fields) {
      const sectionKey = this.normalizeSectionKey(field.section_key);
      const rowKey = `${sectionKey}::${field.field_key}`;
      const before = existingByKey.get(rowKey) ?? null;

      const data = {
        tenantId: assignment.tenantId,
        assignmentId,
        templateKey,
        sectionKey,
        fieldKey: field.field_key,
        source: field.source,
        valueJson: field.value as Prisma.InputJsonValue,
        normalizedText:
          field.normalized_text ??
          (typeof field.value === 'string' || typeof field.value === 'number' ? String(field.value) : null),
        sourceDocumentId: field.source_document_id ?? null,
        ocrJson: jsonObject(field.ocr as unknown as Record<string, unknown> | undefined),
        derivedFromJson: jsonObject(field.derived_from),
        updatedByUserId: actorUserId
      };

      const saved = before
        ? await tx.reportFieldValue.update({
            where: { id: before.id },
            data
          })
        : await tx.reportFieldValue.create({
            data
          });

      existingByKey.set(rowKey, saved);

      await this.appendAuditLog(tx, {
        tenantId: assignment.tenantId,
        assignmentId,
        actorUserId,
        fieldValueId: saved.id,
        action: before ? 'field_updated' : 'field_created',
        entityType: 'report_field_value',
        entityId: saved.id,
        beforeJson: before
          ? {
              source: before.source,
              value: before.valueJson as unknown as Record<string, unknown>,
              normalized_text: before.normalizedText,
              source_document_id: before.sourceDocumentId
            }
          : null,
        afterJson: {
          source: saved.source,
          value: saved.valueJson as unknown as Record<string, unknown>,
          normalized_text: saved.normalizedText,
          source_document_id: saved.sourceDocumentId
        },
        metadataJson: {
          template_key: templateKey,
          section_key: sectionKey,
          field_key: field.field_key
        }
      });
    }

    return this.getDraftContext(tx, assignmentId, { template_key: templateKey });
  }

  async upsertEvidenceLinks(
    tx: TxClient,
    assignmentId: string,
    actorUserId: string | null,
    input: RepogenEvidenceLinksUpsert
  ) {
    const assignment = await this.getAssignment(tx, assignmentId);
    const templateKey = input.template_key as keyof RepogenService['supportedTemplates'];
    if (!(templateKey in this.supportedTemplates)) {
      throw new BadRequestException(`Unsupported template_key ${input.template_key}`);
    }

    const documentIds = Array.from(new Set(input.links.map((row) => row.document_id)));
    const documents = await tx.document.findMany({
      where: {
        tenantId: assignment.tenantId,
        id: { in: documentIds },
        deletedAt: null
      },
      select: { id: true }
    });
    const docsFound = new Set(documents.map((row) => row.id));
    const missing = documentIds.filter((id) => !docsFound.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(`documents not found for assignment tenant: ${missing.join(',')}`);
    }

    if (input.replace_for_target) {
      const targets = Array.from(
        new Set(
          input.links.map((row) => `${this.normalizeSectionKey(row.section_key)}::${row.field_key ?? ''}`)
        )
      ).map((key) => {
        const [sectionKey, fieldKey] = key.split('::');
        return { sectionKey, fieldKey: fieldKey || null };
      });

      await tx.reportEvidenceLink.deleteMany({
        where: {
          tenantId: assignment.tenantId,
          assignmentId,
          templateKey,
          OR: targets.map((target) => ({
            sectionKey: target.sectionKey,
            fieldKey: target.fieldKey
          }))
        }
      });
    }

    for (const row of input.links) {
      const sectionKey = this.normalizeSectionKey(row.section_key);
      const existing = await tx.reportEvidenceLink.findFirst({
        where: {
          tenantId: assignment.tenantId,
          assignmentId,
          templateKey,
          sectionKey,
          fieldKey: row.field_key ?? null,
          documentId: row.document_id
        }
      });

      const saved = existing
        ? await tx.reportEvidenceLink.update({
            where: { id: existing.id },
            data: {
              label: row.label ?? null,
              sortOrder: row.sort_order ?? existing.sortOrder,
              metadataJson: (row.metadata_json ?? {}) as unknown as Prisma.InputJsonObject,
              ocrJson: jsonObject(row.ocr as unknown as Record<string, unknown> | undefined),
              createdByUserId: actorUserId ?? existing.createdByUserId
            }
          })
        : await tx.reportEvidenceLink.create({
            data: {
              tenantId: assignment.tenantId,
              assignmentId,
              templateKey,
              sectionKey,
              fieldKey: row.field_key ?? null,
              documentId: row.document_id,
              label: row.label ?? null,
              sortOrder: row.sort_order ?? 0,
              metadataJson: (row.metadata_json ?? {}) as unknown as Prisma.InputJsonObject,
              ocrJson: jsonObject(row.ocr as unknown as Record<string, unknown> | undefined),
              createdByUserId: actorUserId
            }
          });

      await this.appendAuditLog(tx, {
        tenantId: assignment.tenantId,
        assignmentId,
        actorUserId,
        evidenceLinkId: saved.id,
        action: existing ? 'evidence_link_updated' : 'evidence_link_created',
        entityType: 'report_evidence_link',
        entityId: saved.id,
        metadataJson: {
          template_key: templateKey,
          section_key: sectionKey,
          field_key: row.field_key ?? null,
          document_id: row.document_id
        }
      });
    }

    return this.getDraftContext(tx, assignmentId, { template_key: templateKey });
  }

  async triggerGeneration(
    tx: TxClient,
    assignmentId: string,
    actorUserId: string | null,
    input: RepogenGenerateTrigger
  ) {
    const assignment = await this.getAssignment(tx, assignmentId);
    const templateKey = input.template_key as keyof RepogenService['supportedTemplates'];
    if (!(templateKey in this.supportedTemplates)) {
      throw new BadRequestException(`Unsupported template_key ${input.template_key}`);
    }

    const existing = await tx.reportGenerationJob.findFirst({
      where: {
        tenantId: assignment.tenantId,
        idempotencyKey: input.idempotency_key
      },
      include: {
        templateVersion: { select: { id: true, version: true, label: true } },
        reportPack: {
          include: {
            templateVersion: { select: { id: true, version: true, label: true } },
            artifacts: true
          }
        }
      }
    });

    if (existing) {
      if (existing.assignmentId !== assignmentId || existing.templateKey !== templateKey) {
        throw new BadRequestException('IDEMPOTENCY_KEY_REUSED_FOR_DIFFERENT_TARGET');
      }
      return {
        idempotent: true,
        job: this.serializeJob(existing)
      };
    }

    const { templateVersion } = await this.ensureTemplateVersion(
      tx,
      assignment.tenantId,
      templateKey,
      input.template_version,
      input.report_family
    );

    const [fieldRows, evidenceRows] = await Promise.all([
      tx.reportFieldValue.findMany({
        where: {
          tenantId: assignment.tenantId,
          assignmentId,
          templateKey
        },
        orderBy: [{ sectionKey: 'asc' }, { fieldKey: 'asc' }]
      }),
      tx.reportEvidenceLink.findMany({
        where: {
          tenantId: assignment.tenantId,
          assignmentId,
          templateKey
        },
        orderBy: [{ sectionKey: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }]
      })
    ]);

    const warnings = this.buildWarnings(
      templateKey,
      fieldRows.map((row) => ({
        fieldKey: row.fieldKey,
        sectionKey: row.sectionKey,
        valueJson: row.valueJson,
        ocrJson: row.ocrJson
      })),
      evidenceRows.map((row) => ({
        fieldKey: row.fieldKey,
        sectionKey: row.sectionKey,
        ocrJson: row.ocrJson
      }))
    );

    const job = await tx.reportGenerationJob.create({
      data: {
        tenantId: assignment.tenantId,
        assignmentId,
        templateVersionId: templateVersion.id,
        templateKey,
        reportFamily: input.report_family,
        idempotencyKey: input.idempotency_key,
        status: 'queued',
        queuedAt: new Date(),
        requestedByUserId: actorUserId,
        requestPayloadJson: {
          template_key: input.template_key,
          template_version: input.template_version,
          report_family: input.report_family,
          notes: input.notes ?? null
        },
        warningsJson: jsonArray(warnings as unknown as unknown[])
      },
      include: {
        templateVersion: { select: { id: true, version: true, label: true } },
        reportPack: {
          include: {
            templateVersion: { select: { id: true, version: true, label: true } },
            artifacts: true
          }
        }
      }
    });

    await this.appendAuditLog(tx, {
      tenantId: assignment.tenantId,
      assignmentId,
      actorUserId,
      reportGenerationJobId: job.id,
      action: 'generation_requested',
      entityType: 'report_generation_job',
      entityId: job.id,
      afterJson: {
        status: job.status,
        template_key: job.templateKey,
        idempotency_key: job.idempotencyKey
      },
      metadataJson: {
        warnings_count: warnings.length,
        template_version: templateVersion.version
      }
    });

    return {
      idempotent: false,
      job: this.serializeJob(job)
    };
  }

  async getJobStatus(tx: TxClient, jobId: string) {
    const job = await tx.reportGenerationJob.findFirst({
      where: {
        id: jobId
      },
      include: {
        templateVersion: { select: { id: true, version: true, label: true } },
        reportPack: {
          include: {
            templateVersion: { select: { id: true, version: true, label: true } },
            artifacts: true
          }
        }
      }
    });

    if (!job) {
      throw new NotFoundException(`report_generation_job ${jobId} not found`);
    }

    return this.serializeJob(job);
  }

  async listPacks(tx: TxClient, assignmentId: string, query: RepogenPacksListQuery) {
    const assignment = await this.getAssignment(tx, assignmentId);
    const rows = await tx.reportPack.findMany({
      where: {
        tenantId: assignment.tenantId,
        assignmentId,
        ...(query.template_key ? { templateKey: query.template_key } : {})
      },
      include: {
        templateVersion: { select: { id: true, version: true, label: true } },
        artifacts: true
      },
      orderBy: [{ createdAt: 'desc' }, { version: 'desc' }],
      take: query.limit
    });

    return {
      assignment_id: assignmentId,
      packs: rows.map((row) => this.serializePack(row))
    };
  }
}
