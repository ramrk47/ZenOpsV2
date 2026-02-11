import { describe, expect, it, vi } from 'vitest';
import { DomainService } from './domain.service.js';

const createService = () =>
  new DomainService(
    {
      presignUpload: vi.fn(),
      presignDownload: vi.fn(),
      deleteObject: vi.fn()
    },
    {
      multiTenantEnabled: false,
      internalTenantId: '11111111-1111-1111-1111-111111111111',
      externalTenantId: '22222222-2222-2222-2222-222222222222'
    }
  );

const buildTx = () => {
  const reportRequest = { id: 'req-1', tenantId: 'tenant-1', status: 'requested', deletedAt: null };
  const reservation = { id: 'ledger-1', reportJobId: null };
  const reportJob = { id: 'job-1' };

  return {
    reportRequest: {
      findFirst: vi.fn().mockResolvedValue(reportRequest),
      update: vi.fn().mockResolvedValue({ ...reportRequest, status: 'queued' })
    },
    creditsLedger: {
      findFirst: vi.fn().mockResolvedValue(reservation),
      create: vi.fn().mockResolvedValue(reservation),
      update: vi.fn().mockResolvedValue({ ...reservation, status: 'consumed' })
    },
    reportJob: {
      findFirst: vi.fn().mockResolvedValue(reportJob),
      create: vi.fn().mockResolvedValue(reportJob)
    }
  } as any;
};

const webClaims = {
  sub: '11111111-1111-1111-1111-111111111111',
  tenant_id: '11111111-1111-1111-1111-111111111111',
  user_id: '33333333-3333-3333-3333-333333333333',
  aud: 'web' as const,
  roles: [],
  capabilities: []
};

const assignmentRow = (status: string = 'requested') => ({
  id: 'assignment-1',
  tenantId: '11111111-1111-1111-1111-111111111111',
  source: 'tenant',
  workOrderId: null,
  title: 'Test Assignment',
  summary: 'Summary',
  priority: 'normal',
  status,
  dueDate: null,
  createdByUserId: '33333333-3333-3333-3333-333333333333',
  deletedAt: null,
  createdAt: new Date('2026-02-11T00:00:00.000Z'),
  updatedAt: new Date('2026-02-11T00:00:00.000Z'),
  assignees: []
});

const buildAssignmentGraphTx = () => {
  const state = {
    assignment: assignmentRow(),
    created: false
  };

  return {
    state,
    tx: {
      workOrder: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'work-order-1',
          tenantId: '11111111-1111-1111-1111-111111111111',
          deletedAt: null
        })
      },
      assignment: {
        findFirst: vi.fn().mockImplementation(async (args: any) => {
          if (args?.where?.workOrderId) {
            return state.created ? state.assignment : null;
          }
          return state.assignment;
        }),
        create: vi.fn().mockImplementation(async () => {
          state.created = true;
          return state.assignment;
        }),
        update: vi.fn().mockImplementation(async ({ data }: any) => {
          state.assignment = {
            ...state.assignment,
            ...data
          };
          return state.assignment;
        })
      },
      assignmentTask: {
        findMany: vi.fn().mockResolvedValue([])
      },
      assignmentMessage: {
        findMany: vi.fn().mockResolvedValue([])
      },
      assignmentActivity: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue(undefined)
      },
      assignmentFloor: {
        findMany: vi.fn().mockResolvedValue([])
      },
      documentLink: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'link-1',
          purpose: 'reference',
          createdAt: new Date('2026-02-11T00:00:00.000Z')
        })
      },
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'document-1',
          tenantId: '11111111-1111-1111-1111-111111111111',
          status: 'uploaded',
          deletedAt: null
        })
      }
    } as any
  };
};

describe('DomainService queue/finalize idempotency', () => {
  it('returns existing reservation/job for repeated queue requests', async () => {
    const tx = buildTx();
    const service = createService();

    const result = await service.queueDraft(tx, 'req-1');

    expect(result.reportJobId).toBe('job-1');
    expect(result.alreadyQueued).toBe(true);
    expect(tx.creditsLedger.create).not.toHaveBeenCalled();
    expect(tx.reportJob.create).not.toHaveBeenCalled();
    expect(tx.reportRequest.update).toHaveBeenCalledTimes(1);
  });

  it('converts reserved to consumed and remains idempotent on repeated finalize', async () => {
    const tx = buildTx();
    const service = createService();

    tx.creditsLedger.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'reserved-1' });

    await service.finalize(tx, 'req-1');

    expect(tx.creditsLedger.update).toHaveBeenCalledWith({
      where: { id: 'reserved-1' },
      data: {
        status: 'consumed',
        idempotencyKey: 'consume:req-1'
      }
    });

    tx.creditsLedger.update.mockClear();
    tx.creditsLedger.create.mockClear();

    tx.creditsLedger.findFirst.mockResolvedValueOnce({ id: 'already-consumed' });
    await service.finalize(tx, 'req-1');

    expect(tx.creditsLedger.update).not.toHaveBeenCalled();
    expect(tx.creditsLedger.create).not.toHaveBeenCalled();
  });

  it('reserves once across concurrent queue attempts (mocked concurrency)', async () => {
    const service = createService();
    const state = {
      reservation: null as null | { id: string; reportJobId: string | null },
      job: null as null | { id: string }
    };

    const tx = {
      reportRequest: {
        findFirst: vi.fn().mockResolvedValue({ id: 'req-1', tenantId: 'tenant-1' }),
        update: vi.fn().mockResolvedValue(undefined)
      },
      creditsLedger: {
        findFirst: vi.fn().mockImplementation(async () => state.reservation),
        create: vi.fn().mockImplementation(async () => {
          if (state.reservation) return state.reservation;
          state.reservation = { id: 'reserve-1', reportJobId: null };
          return state.reservation;
        }),
        update: vi.fn().mockImplementation(async (_args) => state.reservation)
      },
      reportJob: {
        findFirst: vi.fn().mockImplementation(async () => state.job),
        create: vi.fn().mockImplementation(async () => {
          if (state.job) return state.job;
          state.job = { id: 'job-1' };
          return state.job;
        })
      }
    } as any;

    const [first, second] = await Promise.all([
      service.queueDraft(tx, 'req-1'),
      service.queueDraft(tx, 'req-1')
    ]);

    expect(first.reportJobId).toBe('job-1');
    expect(second.reportJobId).toBe('job-1');
    expect(state.reservation?.id).toBe('reserve-1');
    expect(state.job?.id).toBe('job-1');
  });
});

describe('DomainService assignment spine', () => {
  it('create assignment writes created activity', async () => {
    const service = createService();
    const { tx } = buildAssignmentGraphTx();

    const created = await service.createAssignment(tx, webClaims, {
      source: 'tenant',
      title: 'Test Assignment',
      priority: 'normal',
      status: 'requested'
    });

    expect(created.id).toBe('assignment-1');
    expect(tx.assignment.create).toHaveBeenCalledTimes(1);
    expect(tx.assignmentActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'created'
        })
      })
    );
  });

  it('status update writes status_changed activity', async () => {
    const service = createService();
    const { tx } = buildAssignmentGraphTx();

    await service.patchAssignment(tx, webClaims, 'assignment-1', {
      status: 'in_progress'
    });

    expect(tx.assignment.update).toHaveBeenCalledTimes(1);
    expect(tx.assignmentActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'status_changed'
        })
      })
    );
  });

  it('create from work_order_id is idempotent', async () => {
    const service = createService();
    const { tx } = buildAssignmentGraphTx();

    await service.createAssignment(tx, webClaims, {
      source: 'external_portal',
      work_order_id: 'work-order-1',
      title: 'From Work Order',
      priority: 'high',
      status: 'requested'
    });

    await service.createAssignment(tx, webClaims, {
      source: 'external_portal',
      work_order_id: 'work-order-1',
      title: 'From Work Order',
      priority: 'high',
      status: 'requested'
    });

    expect(tx.assignment.create).toHaveBeenCalledTimes(1);
  });

  it('attach document creates link and activity', async () => {
    const service = createService();
    const { tx } = buildAssignmentGraphTx();

    await service.attachDocumentToAssignment(tx, webClaims, 'assignment-1', {
      document_id: 'document-1',
      purpose: 'reference'
    });

    expect(tx.documentLink.create).toHaveBeenCalledTimes(1);
    expect(tx.assignmentActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'document_attached'
        })
      })
    );
  });
});

describe('DomainService document/data-bundle guards', () => {
  it('rejects non-internal web tenant in single-tenant mode before DB access', async () => {
    const service = createService();
    const tx = {} as any;

    await expect(
      service.presignUpload(
        tx,
        {
          sub: '11111111-1111-1111-1111-111111111111',
          tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          user_id: '11111111-1111-1111-1111-111111111111',
          aud: 'web',
          roles: [],
          capabilities: []
        },
        {
          purpose: 'reference',
          filename: 'sample.pdf',
          content_type: 'application/pdf',
          size_bytes: 1024
        }
      )
    ).rejects.toThrow('TENANT_NOT_ENABLED');
  });

  it('enforces link correctness on presign upload', async () => {
    const service = createService();
    const tx = {
      workOrder: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'work-order-1',
          portalUserId: '33333333-3333-3333-3333-333333333333'
        })
      },
      assignment: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'assignment-1',
          workOrderId: 'different-work-order'
        })
      },
      reportRequest: {
        findFirst: vi.fn().mockResolvedValue(null)
      }
    } as any;

    await expect(
      service.presignUpload(
        tx,
        {
          sub: '33333333-3333-3333-3333-333333333333',
          tenant_id: '22222222-2222-2222-2222-222222222222',
          user_id: '33333333-3333-3333-3333-333333333333',
          aud: 'portal',
          roles: [],
          capabilities: []
        },
        {
          purpose: 'reference',
          work_order_id: 'work-order-1',
          assignment_id: 'assignment-1',
          filename: 'sample.pdf',
          content_type: 'application/pdf',
          size_bytes: 1024
        }
      )
    ).rejects.toThrow('assignment does not belong to work_order');
  });

  it('applies optimistic schema-version check for data-bundle patch', async () => {
    const service = createService();
    const tx = {
      reportRequest: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'req-1',
          tenantId: 'tenant-1',
          reportInput: {
            schema: {
              version: 2
            },
            schemaId: 'schema-2',
            payload: {}
          }
        })
      }
    } as any;

    await expect(
      service.patchDataBundle(tx, 'req-1', {
        payload_merge: { section: 'updated' },
        expected_schema_version: 1
      })
    ).rejects.toThrow('SCHEMA_VERSION_MISMATCH');
  });
});
