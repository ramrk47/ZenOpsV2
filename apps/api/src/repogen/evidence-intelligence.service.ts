import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  RepogenEvidenceProfileSelect,
  RepogenFieldEvidenceLinksUpsert,
  RepogenOcrEnqueueRequest
} from '@zenops/contracts';
import { Prisma, type TxClient } from '@zenops/db';
import { ensureRepogenEvidenceIntelDefaults, chooseDefaultRepogenEvidenceProfile } from './evidence-intelligence/defaults.js';
import { buildEvidenceChecklist, suggestEvidenceForMissingFields } from './evidence-intelligence/logic.js';
import { RepogenSpineService } from './repogen-spine.service.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toIso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

@Injectable()
export class RepogenEvidenceIntelligenceService {
  constructor(private readonly repogenSpineService: RepogenSpineService) {}

  private async getWorkOrderOrThrow(tx: TxClient, workOrderId: string) {
    const workOrder = await tx.repogenWorkOrder.findFirst({
      where: { id: workOrderId },
      select: {
        id: true,
        orgId: true,
        reportType: true,
        bankType: true,
        valueSlab: true,
        evidenceProfileId: true,
        status: true,
        bankName: true
      }
    });

    if (!workOrder) {
      throw new NotFoundException(`repogen work order ${workOrderId} not found`);
    }

    return workOrder;
  }

  private async getLatestSnapshot(tx: TxClient, workOrderId: string) {
    return tx.repogenContractSnapshot.findFirst({
      where: { workOrderId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        createdAt: true
      }
    });
  }

  private serializeProfileItem(row: {
    id: string;
    evidenceType: string;
    docType: string | null;
    minCount: number;
    isRequired: boolean;
    tagsJson: Prisma.JsonValue | null;
    orderHint: number | null;
    label: string | null;
    fieldKeyHint: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      evidence_type: row.evidenceType,
      doc_type: row.docType,
      min_count: row.minCount,
      is_required: row.isRequired,
      tags_json: row.tagsJson,
      order_hint: row.orderHint,
      label: row.label,
      field_key_hint: row.fieldKeyHint,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  private serializeProfile(row: {
    id: string;
    orgId: string;
    reportType: string;
    bankType: string;
    valueSlab: string;
    name: string;
    isDefault: boolean;
    metadataJson: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
    items?: Array<{
      id: string;
      evidenceType: string;
      docType: string | null;
      minCount: number;
      isRequired: boolean;
      tagsJson: Prisma.JsonValue | null;
      orderHint: number | null;
      label: string | null;
      fieldKeyHint: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
    _count?: { items: number };
  }) {
    return {
      id: row.id,
      org_id: row.orgId,
      report_type: row.reportType,
      bank_type: row.bankType,
      value_slab: row.valueSlab,
      name: row.name,
      is_default: row.isDefault,
      metadata_json: isRecord(row.metadataJson) ? row.metadataJson : {},
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      items_count: row._count?.items ?? row.items?.length ?? 0,
      items: row.items ? row.items.map((item) => this.serializeProfileItem(item)) : undefined
    };
  }

  private serializeFieldDef(row: {
    id: string;
    fieldKey: string;
    label: string;
    dataType: string;
    requiredByDefault: boolean;
    unit: string | null;
    metadataJson: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      field_key: row.fieldKey,
      label: row.label,
      data_type: row.dataType,
      required_by_default: row.requiredByDefault,
      unit: row.unit,
      metadata_json: isRecord(row.metadataJson) ? row.metadataJson : {},
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  private serializeFieldEvidenceLink(row: {
    id: string;
    snapshotId: string;
    fieldKey: string;
    evidenceItemId: string;
    confidence: number | null;
    note: string | null;
    createdByUserId: string | null;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      snapshot_id: row.snapshotId,
      field_key: row.fieldKey,
      evidence_item_id: row.evidenceItemId,
      confidence: row.confidence,
      note: row.note,
      created_by_user_id: row.createdByUserId,
      created_at: row.createdAt.toISOString()
    };
  }

  private serializeOcrJob(row: {
    id: string;
    orgId: string;
    workOrderId: string;
    evidenceItemId: string;
    status: string;
    requestedAt: Date;
    finishedAt: Date | null;
    resultJson: Prisma.JsonValue | null;
    error: string | null;
    createdByUserId: string | null;
    workerTrace: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      org_id: row.orgId,
      work_order_id: row.workOrderId,
      evidence_item_id: row.evidenceItemId,
      status: row.status,
      requested_at: row.requestedAt.toISOString(),
      finished_at: toIso(row.finishedAt),
      result_json: row.resultJson,
      error: row.error,
      created_by_user_id: row.createdByUserId,
      worker_trace: row.workerTrace,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  private async appendAuditNote(
    tx: TxClient,
    workOrder: { orgId: string; id: string },
    actorUserId: string | null,
    message: string
  ): Promise<void> {
    await tx.repogenComment.create({
      data: {
        orgId: workOrder.orgId,
        workOrderId: workOrder.id,
        commentType: 'NOTES',
        body: message,
        createdByUserId: actorUserId
      }
    });
  }

  private async resolveSelectedProfile(tx: TxClient, workOrder: Awaited<ReturnType<RepogenEvidenceIntelligenceService['getWorkOrderOrThrow']>>) {
    await ensureRepogenEvidenceIntelDefaults(tx, workOrder.orgId);

    let selectedProfileId = workOrder.evidenceProfileId;
    if (!selectedProfileId) {
      const chosen = await chooseDefaultRepogenEvidenceProfile(tx, {
        id: workOrder.id,
        orgId: workOrder.orgId,
        reportType: workOrder.reportType,
        bankType: workOrder.bankType,
        valueSlab: workOrder.valueSlab
      });
      if (chosen) {
        selectedProfileId = chosen.id;
        await tx.repogenWorkOrder.update({
          where: { id: workOrder.id },
          data: { evidenceProfileId: selectedProfileId }
        });
      }
    }

    const selectedProfile = selectedProfileId
      ? await tx.repogenEvidenceProfile.findFirst({
          where: { id: selectedProfileId, orgId: workOrder.orgId },
          include: {
            items: {
              orderBy: [{ orderHint: 'asc' }, { createdAt: 'asc' }]
            }
          }
        })
      : null;

    return {
      selectedProfileId: selectedProfile?.id ?? null,
      selectedProfile
    };
  }

  async listEvidenceProfiles(tx: TxClient, workOrderId: string) {
    const workOrder = await this.getWorkOrderOrThrow(tx, workOrderId);
    const { selectedProfileId, selectedProfile } = await this.resolveSelectedProfile(tx, workOrder);
    const [profiles, evidenceRows, detail, fieldDefs] = await Promise.all([
      tx.repogenEvidenceProfile.findMany({
        where: {
          orgId: workOrder.orgId,
          reportType: workOrder.reportType as any
        },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        include: {
          _count: {
            select: { items: true }
          }
        }
      }),
      tx.repogenEvidenceItem.findMany({
        where: { workOrderId },
        select: {
          id: true,
          evidenceType: true,
          docType: true,
          tags: true,
          annexureOrder: true,
          createdAt: true
        }
      }),
      this.repogenSpineService.getWorkOrderDetail(tx, workOrderId),
      tx.repogenFieldDef.findMany({
        where: { orgId: workOrder.orgId },
        orderBy: [{ requiredByDefault: 'desc' }, { fieldKey: 'asc' }]
      })
    ]);

    const checklist = selectedProfile
      ? buildEvidenceChecklist(selectedProfile.items, evidenceRows)
      : [];

    const missingFieldEvidenceLinks = Array.isArray((detail.readiness as any)?.missing_field_evidence_links)
      ? ((detail.readiness as any).missing_field_evidence_links as string[])
      : [];

    const suggestions = suggestEvidenceForMissingFields(missingFieldEvidenceLinks, checklist);

    return {
      work_order_id: workOrder.id,
      selected_profile_id: selectedProfileId,
      selected_profile: selectedProfile ? this.serializeProfile(selectedProfile) : null,
      profiles: profiles.map((row) => this.serializeProfile(row)),
      checklist,
      suggested_evidence_for_missing_fields: suggestions,
      field_defs: fieldDefs.map((row) => this.serializeFieldDef(row)),
      readiness: detail.readiness
    };
  }

  async selectEvidenceProfile(
    tx: TxClient,
    workOrderId: string,
    actorUserId: string,
    input: RepogenEvidenceProfileSelect
  ) {
    const workOrder = await this.getWorkOrderOrThrow(tx, workOrderId);
    await ensureRepogenEvidenceIntelDefaults(tx, workOrder.orgId);

    let profileId: string | null = null;
    if (input.use_default) {
      const chosen = await chooseDefaultRepogenEvidenceProfile(tx, {
        id: workOrder.id,
        orgId: workOrder.orgId,
        reportType: workOrder.reportType,
        bankType: workOrder.bankType,
        valueSlab: workOrder.valueSlab
      });
      profileId = chosen?.id ?? null;
    } else if (input.profile_id) {
      const profile = await tx.repogenEvidenceProfile.findFirst({
        where: {
          id: input.profile_id,
          orgId: workOrder.orgId,
          reportType: workOrder.reportType as any
        },
        select: { id: true, name: true }
      });
      if (!profile) {
        throw new BadRequestException('INVALID_EVIDENCE_PROFILE_FOR_WORK_ORDER');
      }
      profileId = profile.id;
    }

    if (!profileId) {
      throw new BadRequestException('EVIDENCE_PROFILE_NOT_RESOLVED');
    }

    await tx.repogenWorkOrder.update({
      where: { id: workOrder.id },
      data: { evidenceProfileId: profileId }
    });

    await this.appendAuditNote(tx, workOrder, actorUserId, `Evidence profile selected: ${profileId}`);
    return this.listEvidenceProfiles(tx, workOrderId);
  }

  async listFieldEvidenceLinks(tx: TxClient, workOrderId: string) {
    const workOrder = await this.getWorkOrderOrThrow(tx, workOrderId);
    const latestSnapshot = await this.getLatestSnapshot(tx, workOrderId);
    const [fieldDefs, links] = await Promise.all([
      tx.repogenFieldDef.findMany({
        where: { orgId: workOrder.orgId },
        orderBy: [{ requiredByDefault: 'desc' }, { fieldKey: 'asc' }]
      }),
      latestSnapshot
        ? tx.repogenFieldEvidenceLink.findMany({
            where: { workOrderId, snapshotId: latestSnapshot.id },
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
        : Promise.resolve([])
    ]);

    return {
      work_order_id: workOrder.id,
      latest_snapshot_id: latestSnapshot?.id ?? null,
      latest_snapshot_version: latestSnapshot?.version ?? null,
      field_defs: fieldDefs.map((row) => this.serializeFieldDef(row)),
      links: links.map((row) => this.serializeFieldEvidenceLink(row))
    };
  }

  async upsertFieldEvidenceLinks(
    tx: TxClient,
    workOrderId: string,
    actorUserId: string,
    input: RepogenFieldEvidenceLinksUpsert
  ) {
    const workOrder = await this.getWorkOrderOrThrow(tx, workOrderId);
    const latestSnapshot = await this.getLatestSnapshot(tx, workOrderId);
    const snapshotCache = new Map<string, { id: string; version: number }>();
    if (latestSnapshot) {
      snapshotCache.set(latestSnapshot.id, latestSnapshot);
    }

    const evidenceIds = Array.from(new Set(input.links.map((row) => row.evidence_item_id)));
    const evidenceRows = await tx.repogenEvidenceItem.findMany({
      where: {
        workOrderId: workOrder.id,
        id: { in: evidenceIds }
      },
      select: { id: true }
    });
    const validEvidenceIds = new Set(evidenceRows.map((row) => row.id));
    const missingEvidenceIds = evidenceIds.filter((id) => !validEvidenceIds.has(id));
    if (missingEvidenceIds.length > 0) {
      throw new BadRequestException(`evidence item(s) not found for work order: ${missingEvidenceIds.join(', ')}`);
    }

    const actionNotes: string[] = [];

    for (const link of input.links) {
      const targetSnapshotId = link.snapshot_id ?? latestSnapshot?.id ?? null;
      if (!targetSnapshotId) {
        throw new BadRequestException('CONTRACT_SNAPSHOT_REQUIRED_FOR_FIELD_EVIDENCE_LINKS');
      }

      let snapshot = snapshotCache.get(targetSnapshotId);
      if (!snapshot) {
        const fetched = await tx.repogenContractSnapshot.findFirst({
          where: {
            id: targetSnapshotId,
            workOrderId: workOrder.id
          },
          select: { id: true, version: true }
        });
        if (!fetched) {
          throw new BadRequestException(`snapshot ${targetSnapshotId} not found for work order`);
        }
        snapshot = fetched;
        snapshotCache.set(targetSnapshotId, fetched);
      }

      if (link.remove) {
        if (link.id) {
          const existing = await tx.repogenFieldEvidenceLink.findFirst({
            where: {
              id: link.id,
              workOrderId: workOrder.id
            },
            select: {
              id: true,
              fieldKey: true,
              evidenceItemId: true,
              snapshotId: true
            }
          });
          if (existing) {
            await tx.repogenFieldEvidenceLink.delete({ where: { id: existing.id } });
            actionNotes.push(`Removed ${existing.fieldKey} <- ${existing.evidenceItemId} (snapshot ${existing.snapshotId})`);
          }
          continue;
        }

        const removed = await tx.repogenFieldEvidenceLink.deleteMany({
          where: {
            workOrderId: workOrder.id,
            snapshotId: snapshot.id,
            fieldKey: link.field_key,
            evidenceItemId: link.evidence_item_id
          }
        });
        if (removed.count > 0) {
          actionNotes.push(`Removed ${link.field_key} <- ${link.evidence_item_id} (snapshot v${snapshot.version})`);
        }
        continue;
      }

      if (link.id) {
        const existing = await tx.repogenFieldEvidenceLink.findFirst({
          where: {
            id: link.id,
            workOrderId: workOrder.id
          },
          select: { id: true, fieldKey: true, evidenceItemId: true, snapshotId: true }
        });
        if (!existing) {
          throw new NotFoundException(`repogen field evidence link ${link.id} not found`);
        }
        await tx.repogenFieldEvidenceLink.update({
          where: { id: existing.id },
          data: {
            snapshotId: snapshot.id,
            fieldKey: link.field_key,
            evidenceItemId: link.evidence_item_id,
            confidence: link.confidence ?? null,
            note: link.note ?? null
          }
        });
        actionNotes.push(`Updated ${link.field_key} <- ${link.evidence_item_id} (snapshot v${snapshot.version})`);
        continue;
      }

      const existing = await tx.repogenFieldEvidenceLink.findFirst({
        where: {
          workOrderId: workOrder.id,
          snapshotId: snapshot.id,
          fieldKey: link.field_key,
          evidenceItemId: link.evidence_item_id
        },
        select: { id: true }
      });

      if (existing) {
        await tx.repogenFieldEvidenceLink.update({
          where: { id: existing.id },
          data: {
            confidence: link.confidence ?? null,
            note: link.note ?? null
          }
        });
        actionNotes.push(`Refreshed ${link.field_key} <- ${link.evidence_item_id} (snapshot v${snapshot.version})`);
      } else {
        await tx.repogenFieldEvidenceLink.create({
          data: {
            orgId: workOrder.orgId,
            workOrderId: workOrder.id,
            snapshotId: snapshot.id,
            fieldKey: link.field_key,
            evidenceItemId: link.evidence_item_id,
            confidence: link.confidence ?? null,
            note: link.note ?? null,
            createdByUserId: actorUserId
          }
        });
        actionNotes.push(`Linked ${link.field_key} <- ${link.evidence_item_id} (snapshot v${snapshot.version})`);
      }
    }

    if (actionNotes.length > 0) {
      await this.appendAuditNote(
        tx,
        workOrder,
        actorUserId,
        `Field evidence links updated:\n${actionNotes.slice(0, 20).map((line) => `- ${line}`).join('\n')}`
      );
    }

    const [linksView, detail] = await Promise.all([
      this.listFieldEvidenceLinks(tx, workOrder.id),
      this.repogenSpineService.getWorkOrderDetail(tx, workOrder.id)
    ]);

    return {
      ...linksView,
      readiness: detail.readiness
    };
  }

  async enqueueOcrPlaceholder(
    tx: TxClient,
    workOrderId: string,
    actorUserId: string,
    input: RepogenOcrEnqueueRequest,
    meta: { tenant_id: string; request_id: string }
  ) {
    const workOrder = await this.getWorkOrderOrThrow(tx, workOrderId);
    const evidenceItem = await tx.repogenEvidenceItem.findFirst({
      where: {
        id: input.evidence_item_id,
        workOrderId: workOrder.id
      },
      select: {
        id: true,
        evidenceType: true,
        docType: true
      }
    });

    if (!evidenceItem) {
      throw new BadRequestException('EVIDENCE_ITEM_NOT_FOUND_FOR_WORK_ORDER');
    }

    const ocrJob = await tx.repogenOcrJob.create({
      data: {
        orgId: workOrder.orgId,
        workOrderId: workOrder.id,
        evidenceItemId: evidenceItem.id,
        status: 'QUEUED',
        createdByUserId: actorUserId
      }
    });

    await this.appendAuditNote(
      tx,
      workOrder,
      actorUserId,
      `OCR placeholder enqueued for evidence ${evidenceItem.id} (${evidenceItem.evidenceType}${evidenceItem.docType ? `/${evidenceItem.docType}` : ''})`
    );

    return {
      work_order_id: workOrder.id,
      ocr_job: this.serializeOcrJob(ocrJob),
      queue_payload: {
        ocrJobId: ocrJob.id,
        workOrderId: workOrder.id,
        evidenceItemId: evidenceItem.id,
        tenantId: meta.tenant_id,
        requestId: meta.request_id
      }
    };
  }
}
