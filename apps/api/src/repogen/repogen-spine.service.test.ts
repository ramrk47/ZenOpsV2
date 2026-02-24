import { describe, expect, it, vi } from 'vitest';
import { RepogenSpineService } from './repogen-spine.service.js';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const makeState = () => ({
  workOrders: [] as any[],
  snapshots: [] as any[],
  evidenceItems: [] as any[],
  rulesRuns: [] as any[],
  comments: [] as any[],
  documents: [] as any[]
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));

const createTx = (state: ReturnType<typeof makeState>) => {
  const getSnapshotById = (id: string) => state.snapshots.find((row) => row.id === id) ?? null;
  const selectLatestSnapshotForWorkOrder = (workOrderId: string) =>
    state.snapshots
      .filter((row) => row.workOrderId === workOrderId)
      .sort((a, b) => b.version - a.version)[0] ?? null;

  return {
    repogenWorkOrder: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const row = {
          id: `wo-${state.workOrders.length + 1}`,
          orgId: data.orgId,
          sourceType: data.sourceType,
          sourceRefId: data.sourceRefId ?? null,
          assignmentId: data.assignmentId ?? null,
          reportType: data.reportType,
          bankName: data.bankName,
          bankType: data.bankType,
          valueSlab: 'UNKNOWN',
          templateSelector: 'UNKNOWN',
          status: 'DRAFT',
          billingModeCache: null,
          billingAccountId: null,
          billingReservationId: null,
          billingServiceInvoiceId: null,
          billingHooksJson: data.billingHooksJson ?? {},
          createdByUserId: data.createdByUserId ?? null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        state.workOrders.push(row);
        return row;
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where?.id) {
          return state.workOrders.find((row) => row.id === where.id) ?? null;
        }
        return null;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const row = state.workOrders.find((item) => item.id === where.id);
        if (!row) throw new Error('workOrder not found');
        Object.assign(row, data);
        row.updatedAt = new Date();
        return row;
      }),
      findMany: vi.fn().mockResolvedValue([])
    },
    repogenContractSnapshot: {
      findFirst: vi.fn().mockImplementation(async ({ where, orderBy }: any) => {
        let rows = state.snapshots.slice();
        if (where?.workOrderId) rows = rows.filter((row) => row.workOrderId === where.workOrderId);
        if (where?.version) rows = rows.filter((row) => row.version === where.version);
        if (orderBy?.version === 'desc') {
          rows.sort((a, b) => b.version - a.version);
        }
        return rows[0] ?? null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const row = {
          id: `snap-${state.snapshots.length + 1}`,
          orgId: data.orgId,
          workOrderId: data.workOrderId,
          version: data.version,
          contractJson: clone(data.contractJson),
          derivedJson: clone(data.derivedJson),
          readinessJson: clone(data.readinessJson),
          createdByUserId: data.createdByUserId ?? null,
          createdAt: new Date()
        };
        state.snapshots.push(row);
        return row;
      })
    },
    repogenEvidenceItem: {
      findMany: vi.fn().mockImplementation(async ({ where }: any) => {
        let rows = state.evidenceItems.slice();
        if (where?.workOrderId) rows = rows.filter((row) => row.workOrderId === where.workOrderId);
        return rows;
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        return (
          state.evidenceItems.find(
            (row) => row.id === where.id && (where.workOrderId ? row.workOrderId === where.workOrderId : true)
          ) ?? null
        );
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const row = {
          id: `evidence-${state.evidenceItems.length + 1}`,
          orgId: data.orgId,
          workOrderId: data.workOrderId,
          evidenceType: data.evidenceType,
          docType: data.docType ?? null,
          classification: data.classification ?? null,
          sensitivity: data.sensitivity ?? null,
          source: data.source ?? null,
          documentId: data.documentId ?? null,
          fileRef: data.fileRef ?? null,
          capturedByEmployeeId: data.capturedByEmployeeId ?? null,
          capturedAt: data.capturedAt ?? null,
          annexureOrder: data.annexureOrder ?? null,
          tags: data.tags ?? null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        state.evidenceItems.push(row);
        return row;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const row = state.evidenceItems.find((item) => item.id === where.id);
        if (!row) throw new Error('evidence not found');
        Object.assign(row, data);
        row.updatedAt = new Date();
        return row;
      })
    },
    repogenRulesRun: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const row = {
          id: `rules-${state.rulesRuns.length + 1}`,
          orgId: data.orgId,
          workOrderId: data.workOrderId,
          inputSnapshotId: data.inputSnapshotId,
          outputSnapshotId: data.outputSnapshotId,
          rulesetVersion: data.rulesetVersion,
          warnings: clone(data.warnings),
          errors: clone(data.errors),
          createdAt: new Date()
        };
        state.rulesRuns.push(row);
        return {
          ...row,
          inputSnapshot: getSnapshotById(row.inputSnapshotId),
          outputSnapshot: getSnapshotById(row.outputSnapshotId)
        };
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: any) => {
        return state.rulesRuns
          .filter((row) => (where?.workOrderId ? row.workOrderId === where.workOrderId : true))
          .slice()
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((row) => ({
            ...row,
            inputSnapshot: getSnapshotById(row.inputSnapshotId),
            outputSnapshot: getSnapshotById(row.outputSnapshotId)
          }));
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        const row = state.rulesRuns
          .filter((item) => (where?.workOrderId ? item.workOrderId === where.workOrderId : true))
          .slice()
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        return row ? { ...row } : null;
      })
    },
    repogenComment: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const row = {
          id: `comment-${state.comments.length + 1}`,
          orgId: data.orgId,
          workOrderId: data.workOrderId,
          commentType: data.commentType,
          body: data.body,
          createdByUserId: data.createdByUserId ?? null,
          createdAt: new Date()
        };
        state.comments.push(row);
        return row;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: any) => {
        return state.comments
          .filter((row) => (where?.workOrderId ? row.workOrderId === where.workOrderId : true))
          .slice()
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      })
    },
    document: {
      findMany: vi.fn().mockImplementation(async ({ where }: any) => {
        const ids: string[] = where?.id?.in ?? [];
        return state.documents.filter((doc) => ids.includes(doc.id) && doc.deletedAt === null);
      })
    }
  } as any;
};

const makeService = () => {
  const billingControlService = {
    ensureRepogenAcceptanceBilling: vi.fn().mockResolvedValue({
      mode: 'CREDIT',
      account_id: 'acct-1',
      reservation_id: 'res-1',
      service_invoice_id: null
    }),
    ingestUsageEvent: vi.fn().mockResolvedValue({ id: 'usage-1' })
  } as any;

  return {
    billingControlService,
    service: new RepogenSpineService(billingControlService)
  };
};

describe('RepogenSpineService', () => {
  it('creates work orders, persists evidence, snapshots, rules runs, and deterministic export bundle', async () => {
    const state = makeState();
    state.documents.push(
      {
        id: 'doc-b',
        originalFilename: 'b.jpg',
        contentType: 'image/jpeg',
        sizeBytes: BigInt(200),
        status: 'uploaded',
        classification: 'site_photo',
        source: 'mobile_camera',
        storageKey: 'objects/doc-b.jpg',
        deletedAt: null
      },
      {
        id: 'doc-a',
        originalFilename: 'a.jpg',
        contentType: 'image/jpeg',
        sizeBytes: BigInt(100),
        status: 'uploaded',
        classification: 'site_photo',
        source: 'mobile_camera',
        storageKey: 'objects/doc-a.jpg',
        deletedAt: null
      }
    );
    const tx = createTx(state);
    const { service } = makeService();

    const created = await service.createWorkOrder(tx, ORG_ID, USER_ID, {
      source_type: 'TENANT',
      report_type: 'VALUATION',
      bank_name: 'State Bank of India',
      bank_type: 'SBI'
    });

    await service.upsertEvidenceLinks(tx, created.work_order_id, USER_ID, {
      items: [
        { evidence_type: 'PHOTO', doc_type: 'OTHER', document_id: 'doc-b', annexure_order: 2 },
        { evidence_type: 'PHOTO', doc_type: 'OTHER', document_id: 'doc-a', annexure_order: 1 }
      ]
    });

    const patchResult = await service.patchContract(tx, created.work_order_id, USER_ID, {
      patch: {
        property: {
          address: 'Fixture address',
          land_area: { value: 1000, unit: 'sqft' },
          floors: []
        },
        valuation_inputs: {
          market_rate_input: { value: 2000, unit: 'sqft' },
          guideline_rate_input: { value: 1500, unit: 'sqft' },
          land_value: 2_000_000,
          building_value: 3_000_000
        }
      },
      ruleset_version: 'm5.4-v1'
    });

    expect(state.snapshots).toHaveLength(2);
    expect(state.rulesRuns).toHaveLength(1);
    expect(patchResult.output_snapshot?.version).toBe(2);
    expect((patchResult.rules_run?.ruleset_version as string) ?? '').toBe('m5.4-v1');

    const exported = await service.exportWorkOrder(tx, created.work_order_id, {});
    const bundle = exported.export_bundle as any;
    expect(bundle.snapshot_version).toBe(2);
    expect(bundle.derived_json.computed_values.FMV).toBe(5_000_000);
    expect(bundle.derived_json.computed_values.realizable_value).toBe(4_750_000);
    expect(bundle.evidence_manifest).toHaveLength(2);
    expect(bundle.evidence_manifest[0].document_id).toBe('doc-a');
    expect(bundle.evidence_manifest[1].document_id).toBe('doc-b');
  });

  it('enforces readiness gates for READY_FOR_RENDER and triggers billing hooks on DATA_PENDING', async () => {
    const state = makeState();
    for (let index = 0; index < 6; index += 1) {
      state.documents.push({
        id: `photo-${index + 1}`,
        originalFilename: `photo-${index + 1}.jpg`,
        contentType: 'image/jpeg',
        sizeBytes: BigInt(100 + index),
        status: 'uploaded',
        classification: 'site_photo',
        source: 'mobile_camera',
        storageKey: `objects/photo-${index + 1}.jpg`,
        deletedAt: null
      });
    }
    const tx = createTx(state);
    const { service, billingControlService } = makeService();

    const created = await service.createWorkOrder(tx, ORG_ID, USER_ID, {
      source_type: 'TENANT',
      report_type: 'VALUATION',
      bank_name: 'SBI',
      bank_type: 'SBI'
    });

    await service.patchContract(tx, created.work_order_id, USER_ID, {
      patch: {
        property: {
          address: 'Fixture address',
          land_area: { value: 100, unit: 'sqm' },
          floors: []
        },
        valuation_inputs: {
          guideline_rate_per_sqm: 10000,
          land_value: 1000000,
          building_value: 500000
        }
      },
      ruleset_version: 'm5.4-v1'
    });

    await service.transitionStatus(tx, created.work_order_id, USER_ID, { status: 'EVIDENCE_PENDING' });
    await service.transitionStatus(tx, created.work_order_id, USER_ID, { status: 'DATA_PENDING' });

    await expect(
      service.transitionStatus(tx, created.work_order_id, USER_ID, { status: 'READY_FOR_RENDER' })
    ).rejects.toThrow(/REPOGEN_READINESS_BLOCK|READY_FOR_RENDER blocked/i);

    await service.upsertEvidenceLinks(tx, created.work_order_id, USER_ID, {
      items: state.documents.map((doc, idx) => ({
        evidence_type: 'PHOTO',
        doc_type: 'OTHER',
        document_id: doc.id,
        annexure_order: idx + 1
      }))
    });

    const finalDetail = await service.transitionStatus(tx, created.work_order_id, USER_ID, { status: 'READY_FOR_RENDER' });

    expect((finalDetail.work_order.status as string) ?? '').toBe('READY_FOR_RENDER');
    expect(finalDetail.readiness.completeness_score).toBe(100);
    expect(billingControlService.ensureRepogenAcceptanceBilling).toHaveBeenCalledTimes(1);
    expect(billingControlService.ingestUsageEvent).toHaveBeenCalledTimes(1);
  });
});
