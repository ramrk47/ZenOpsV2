import { describe, expect, it, vi } from 'vitest';
import { RepogenFactoryService } from './repogen-factory.service.js';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const WORK_ORDER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ASSIGNMENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

type FactoryState = ReturnType<typeof makeState>;

const makeState = () => ({
  workOrders: [
    {
      id: WORK_ORDER_ID,
      orgId: ORG_ID,
      assignmentId: ASSIGNMENT_ID,
      reportType: 'VALUATION',
      bankType: 'SBI',
      valueSlab: 'LT_5CR',
      templateSelector: 'SBI_FORMAT_A',
      status: 'READY_FOR_RENDER',
      reportPackId: null,
      billingModeCache: 'CREDIT',
      billingAccountId: 'acct-1',
      billingReservationId: 'resv-1',
      billingServiceInvoiceId: null,
      billingHooksJson: {}
    }
  ] as any[],
  snapshots: [
    {
      id: 'snap-2',
      workOrderId: WORK_ORDER_ID,
      version: 2,
      readinessJson: {
        completeness_score: 100,
        missing_fields: [],
        missing_evidence: [],
        warnings: [],
        required_evidence_minimums: {}
      },
      contractJson: { meta: { report_type: 'VALUATION' } },
      derivedJson: { computed_values: { FMV: 1000000 } },
      createdAt: new Date('2026-02-24T10:00:00.000Z')
    }
  ] as any[],
  packs: [] as any[],
  jobs: [] as any[],
  artifacts: [] as any[],
  releases: [] as any[],
  auditLogs: [] as any[]
});

const clone = <T>(value: T): T => {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, clone(v)])) as T;
  }
  return value;
};

const makePackView = (state: FactoryState, packRow: any | null) => {
  if (!packRow) return null;
  const artifacts = state.artifacts.filter((row) => row.reportPackId === packRow.id).map((row) => clone(row));
  const generationJob = state.jobs.find((row) => row.reportPackId === packRow.id) ?? null;
  return {
    ...clone(packRow),
    artifacts,
    generationJob: generationJob ? clone(generationJob) : null
  };
};

const createTx = (state: FactoryState) => {
  return {
    repogenWorkOrder: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        const row = state.workOrders.find((item) => item.id === where.id) ?? null;
        if (!row) return null;
        const latestSnapshot = state.snapshots
          .filter((snap) => snap.workOrderId === row.id)
          .slice()
          .sort((a, b) => b.version - a.version)[0];
        const primaryPack = row.reportPackId ? state.packs.find((pack) => pack.id === row.reportPackId) ?? null : null;
        const reversePack = state.packs.find((pack) => pack.workOrderId === row.id) ?? null;
        return {
          ...clone(row),
          snapshots: latestSnapshot ? [clone(latestSnapshot)] : [],
          reportPack: makePackView(state, primaryPack),
          factoryReportPack: makePackView(state, reversePack),
          deliverableReleases: state.releases
            .filter((rel) => rel.workOrderId === row.id)
            .slice()
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map((rel) => clone(rel))
        };
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const row = state.workOrders.find((item) => item.id === where.id);
        if (!row) throw new Error('work order not found');
        Object.assign(row, data);
        return clone(row);
      })
    },
    reportPack: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        let rows = state.packs.slice();
        if (where?.tenantId) rows = rows.filter((row) => row.tenantId === where.tenantId);
        if (where?.assignmentId) rows = rows.filter((row) => row.assignmentId === where.assignmentId);
        if (where?.templateKey) rows = rows.filter((row) => row.templateKey === where.templateKey);
        if (where?.id) rows = rows.filter((row) => row.id === where.id);
        rows.sort((a, b) => b.version - a.version);
        return rows[0] ? clone(rows[0]) : null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const row = {
          id: `pack-${state.packs.length + 1}`,
          tenantId: data.tenantId,
          assignmentId: data.assignmentId,
          workOrderId: data.workOrderId ?? null,
          templateVersionId: data.templateVersionId ?? null,
          templateKey: data.templateKey,
          reportFamily: data.reportFamily,
          version: data.version,
          status: data.status,
          createdByUserId: data.createdByUserId ?? null,
          warningsJson: clone(data.warningsJson ?? []),
          contextSnapshotJson: clone(data.contextSnapshotJson ?? null),
          generatedAt: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        state.packs.push(row);
        return {
          ...clone(row),
          artifacts: [],
          generationJob: null
        };
      })
    },
    reportPackArtifact: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const row = {
          id: `artifact-${state.artifacts.length + 1}`,
          tenantId: data.tenantId,
          reportPackId: data.reportPackId,
          kind: data.kind,
          filename: data.filename,
          storageRef: data.storageRef,
          mimeType: data.mimeType,
          sizeBytes: data.sizeBytes ?? BigInt(0),
          checksumSha256: data.checksumSha256 ?? null,
          metadataJson: clone(data.metadataJson ?? {}),
          createdAt: new Date(),
          updatedAt: new Date()
        };
        state.artifacts.push(row);
        return clone(row);
      })
    },
    reportGenerationJob: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        let rows = state.jobs.slice();
        if (where?.tenantId) rows = rows.filter((row) => row.tenantId === where.tenantId);
        if (where?.idempotencyKey) rows = rows.filter((row) => row.idempotencyKey === where.idempotencyKey);
        if (where?.reportPackId) rows = rows.filter((row) => row.reportPackId === where.reportPackId);
        return rows[0] ? clone(rows[0]) : null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const row = {
          id: `job-${state.jobs.length + 1}`,
          tenantId: data.tenantId,
          assignmentId: data.assignmentId,
          templateVersionId: data.templateVersionId ?? null,
          templateKey: data.templateKey,
          reportFamily: data.reportFamily,
          idempotencyKey: data.idempotencyKey,
          status: data.status,
          attempts: 0,
          errorMessage: null,
          workerTrace: null,
          requestedByUserId: data.requestedByUserId ?? null,
          requestPayloadJson: clone(data.requestPayloadJson ?? {}),
          warningsJson: clone(data.warningsJson ?? []),
          reportPackId: data.reportPackId ?? null,
          queuedAt: data.queuedAt ?? null,
          startedAt: null,
          finishedAt: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        state.jobs.push(row);
        return clone(row);
      })
    },
    reportAuditLog: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const row = { id: `audit-${state.auditLogs.length + 1}`, ...clone(data), createdAt: new Date() };
        state.auditLogs.push(row);
        return row;
      })
    },
    repogenDeliverableRelease: {
      findFirst: vi.fn().mockImplementation(async ({ where, orderBy }: any) => {
        let rows = state.releases.slice();
        if (where?.orgId) rows = rows.filter((row) => row.orgId === where.orgId);
        if (where?.idempotencyKey) rows = rows.filter((row) => row.idempotencyKey === where.idempotencyKey);
        if (where?.workOrderId) rows = rows.filter((row) => row.workOrderId === where.workOrderId);
        if (where?.reportPackId) rows = rows.filter((row) => row.reportPackId === where.reportPackId);
        if (where?.billingGateResult?.in) {
          const allowed = new Set(where.billingGateResult.in);
          rows = rows.filter((row) => allowed.has(row.billingGateResult));
        }
        if (orderBy?.createdAt === 'desc') {
          rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return rows[0] ? clone(rows[0]) : null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const now = new Date();
        const row = {
          id: `release-${state.releases.length + 1}`,
          orgId: data.orgId,
          workOrderId: data.workOrderId,
          reportPackId: data.reportPackId,
          releasedByUserId: data.releasedByUserId ?? null,
          releasedAt: now,
          billingModeAtRelease: data.billingModeAtRelease,
          billingGateResult: data.billingGateResult,
          overrideReason: data.overrideReason ?? null,
          idempotencyKey: data.idempotencyKey,
          metadataJson: clone(data.metadataJson ?? {}),
          createdAt: now,
          updatedAt: now
        };
        state.releases.push(row);
        return clone(row);
      })
    }
  } as any;
};

const makeFactory = (state: FactoryState, overrides?: { invoice?: { status: string; is_paid: boolean } }) => {
  const repogenSpineService = {
    exportWorkOrder: vi.fn().mockResolvedValue({
      work_order: { id: WORK_ORDER_ID },
      snapshot: { version: 2 },
      export_bundle: {
        work_order_id: WORK_ORDER_ID,
        snapshot_version: 2,
        contract_json: { meta: { report_type: 'VALUATION', template_selector: 'SBI_FORMAT_A' } },
        derived_json: { computed_values: { FMV: 1000000, realizable_value: 950000, distress_value: 800000 } },
        readiness_json: { completeness_score: 100, missing_fields: [], missing_evidence: [], warnings: [] },
        evidence_manifest: []
      }
    })
  } as any;

  const billingControlService = {
    getServiceInvoice: vi.fn().mockResolvedValue(
      overrides?.invoice ?? {
        id: 'svc-1',
        status: 'PAID',
        is_paid: true
      }
    ),
    consumeCredits: vi.fn().mockResolvedValue({ id: 'ledger-1' }),
    ingestUsageEvent: vi.fn().mockResolvedValue({ id: 'usage-1' })
  } as any;

  return {
    service: new RepogenFactoryService(repogenSpineService, billingControlService),
    repogenSpineService,
    billingControlService
  };
};

describe('RepogenFactoryService', () => {
  it('creates a linked pack/job once and returns idempotently on subsequent ensure calls', async () => {
    const state = makeState();
    const tx = createTx(state);
    const { service } = makeFactory(state);

    const first = await service.ensureReportPackForWorkOrder(tx, {
      work_order_id: WORK_ORDER_ID,
      actor_user_id: USER_ID,
      request_id: 'req-1'
    });

    expect(first.idempotent).toBe(false);
    expect(first.queue_payload?.assignmentId).toBe(ASSIGNMENT_ID);
    expect(state.packs).toHaveLength(1);
    expect(state.jobs).toHaveLength(1);
    expect(state.artifacts).toHaveLength(1);
    expect(state.workOrders[0]?.reportPackId).toBe(state.packs[0]?.id);
    expect(state.artifacts[0]?.kind).toBe('debug_json');
    expect((state.artifacts[0]?.metadataJson as any)?.export_bundle_hash).toBeTypeOf('string');

    const second = await service.ensureReportPackForWorkOrder(tx, {
      work_order_id: WORK_ORDER_ID,
      actor_user_id: USER_ID,
      request_id: 'req-2'
    });

    expect(second.idempotent).toBe(true);
    expect(state.packs).toHaveLength(1);
    expect(state.jobs).toHaveLength(1);
    expect(state.artifacts).toHaveLength(1);
    expect(second.pack_link.pack?.id).toBe(first.pack_link.pack?.id);
    expect(second.pack_link.generation_job?.id).toBe(first.pack_link.generation_job?.id);
  });

  it('consumes reserved credit on release and returns idempotently for the same idempotency key', async () => {
    const state = makeState();
    const tx = createTx(state);
    const { service, billingControlService } = makeFactory(state);

    await service.ensureReportPackForWorkOrder(tx, {
      work_order_id: WORK_ORDER_ID,
      actor_user_id: USER_ID,
      request_id: 'req-1'
    });

    state.jobs[0].status = 'completed';
    state.jobs[0].finishedAt = new Date();
    state.packs[0].status = 'generated';
    state.packs[0].generatedAt = new Date();

    const first = await service.releaseDeliverables(tx, {
      work_order_id: WORK_ORDER_ID,
      actor_user_id: USER_ID,
      request: {
        idempotency_key: 'release-credit-1'
      }
    });

    expect(first.idempotent).toBe(false);
    expect(first.blocked).toBe(false);
    expect(first.release.billing_gate_result).toBe('CREDIT_CONSUMED');
    expect(billingControlService.consumeCredits).toHaveBeenCalledTimes(1);
    expect(state.releases).toHaveLength(1);

    const second = await service.releaseDeliverables(tx, {
      work_order_id: WORK_ORDER_ID,
      actor_user_id: USER_ID,
      request: {
        idempotency_key: 'release-credit-1'
      }
    });

    expect(second.idempotent).toBe(true);
    expect(second.blocked).toBe(false);
    expect(billingControlService.consumeCredits).toHaveBeenCalledTimes(1);
    expect(state.releases).toHaveLength(1);
  });

  it('blocks unpaid postpaid release unless override and records both attempts', async () => {
    const state = makeState();
    state.workOrders[0].billingModeCache = 'POSTPAID';
    state.workOrders[0].billingReservationId = null;
    state.workOrders[0].billingServiceInvoiceId = 'svc-1';
    const tx = createTx(state);
    const { service, billingControlService } = makeFactory(state, {
      invoice: {
        status: 'ISSUED',
        is_paid: false
      }
    });

    await service.ensureReportPackForWorkOrder(tx, {
      work_order_id: WORK_ORDER_ID,
      actor_user_id: USER_ID,
      request_id: 'req-1'
    });
    state.jobs[0].status = 'completed';
    state.packs[0].status = 'generated';

    const blocked = await service.releaseDeliverables(tx, {
      work_order_id: WORK_ORDER_ID,
      actor_user_id: USER_ID,
      request: {
        idempotency_key: 'release-postpaid-blocked'
      }
    });

    expect(blocked.blocked).toBe(true);
    expect(blocked.release.billing_gate_result).toBe('BLOCKED');
    expect(billingControlService.consumeCredits).not.toHaveBeenCalled();

    const override = await service.releaseDeliverables(tx, {
      work_order_id: WORK_ORDER_ID,
      actor_user_id: USER_ID,
      request: {
        idempotency_key: 'release-postpaid-override',
        override: true,
        override_reason: 'Manual payment proof verified offline'
      }
    });

    expect(override.blocked).toBe(false);
    expect(override.release.billing_gate_result).toBe('OVERRIDE');
    expect(state.releases).toHaveLength(2);
    expect(billingControlService.getServiceInvoice).toHaveBeenCalled();
  });
});

