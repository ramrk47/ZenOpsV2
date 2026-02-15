import { describe, expect, it, vi } from 'vitest';
import { DomainService } from './domain.service.js';

const createBillingServiceMock = () => ({
  addUsageLineForFinalize: vi.fn().mockResolvedValue({
    invoice: {
      id: 'invoice-1',
      tenantId: 'tenant-1',
      periodStart: new Date('2026-02-01T00:00:00.000Z'),
      periodEnd: new Date('2026-03-01T00:00:00.000Z'),
      status: 'open',
      currency: 'INR',
      subtotalPaise: BigInt(0),
      taxPaise: BigInt(0),
      totalPaise: BigInt(0),
      issuedAt: null,
      paidAt: null,
      createdAt: new Date('2026-02-11T00:00:00.000Z'),
      updatedAt: new Date('2026-02-11T00:00:00.000Z')
    },
    usageEvent: {
      id: 'usage-1',
      unitPricePaise: 0,
      amountPaise: BigInt(0),
      units: 1
    },
    invoiceLine: {
      id: 'line-1',
      amountPaise: BigInt(0),
      unitPricePaise: 0,
      qty: 1
    },
    createdUsageEvent: true,
    createdInvoiceLine: true
  }),
  getBillingMe: vi.fn().mockResolvedValue({}),
  listInvoices: vi.fn().mockResolvedValue([]),
  getInvoice: vi.fn().mockResolvedValue({}),
  markInvoicePaid: vi.fn().mockResolvedValue({
    id: 'invoice-1',
    total_paise: 0,
    paid_at: null
  })
});

const createNotificationsServiceMock = () => ({
  enqueueTemplate: vi.fn().mockResolvedValue({
    id: 'outbox-1'
  }),
  enqueueEvent: vi.fn().mockResolvedValue([{
    id: 'outbox-1'
  }])
});

const createService = (
  billingService: ReturnType<typeof createBillingServiceMock> = createBillingServiceMock(),
  notificationsService: ReturnType<typeof createNotificationsServiceMock> = createNotificationsServiceMock()
) =>
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
    },
    billingService as any,
    {} as any,
    notificationsService as any,
    {
      enqueueRecompute: vi.fn().mockResolvedValue(undefined)
    } as any
  );

const buildTx = () => {
  const reportRequest = {
    id: 'req-1',
    tenantId: 'tenant-1',
    assignmentId: null,
    status: 'requested',
    deletedAt: null
  };
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
    },
    assignmentActivity: {
      create: vi.fn().mockResolvedValue(undefined)
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
  sourceType: 'direct',
  stage: 'draft_created',
  workOrderId: null,
  bankId: null,
  bankBranchId: null,
  clientOrgId: null,
  propertyId: null,
  channelId: null,
  primaryContactId: null,
  feePaise: null,
  title: 'Test Assignment',
  summary: 'Summary',
  priority: 'normal',
  status,
  dueAt: null,
  dueDate: null,
  createdByUserId: '33333333-3333-3333-3333-333333333333',
  deletedAt: null,
  createdAt: new Date('2026-02-11T00:00:00.000Z'),
  updatedAt: new Date('2026-02-11T00:00:00.000Z'),
  assignees: [],
  bank: null,
  bankBranch: null,
  clientOrg: null,
  property: null,
  primaryContact: null
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
      bank: {
        findFirst: vi.fn().mockResolvedValue(null)
      },
      bankBranch: {
        findFirst: vi.fn().mockResolvedValue(null)
      },
      clientOrg: {
        findFirst: vi.fn().mockResolvedValue(null)
      },
      contact: {
        findFirst: vi.fn().mockResolvedValue(null)
      },
      property: {
        findFirst: vi.fn().mockResolvedValue(null)
      },
      channel: {
        findFirst: vi.fn().mockResolvedValue(null)
      },
      assignmentSourceRecord: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue(undefined)
      },
      assignmentStatusHistory: {
        create: vi.fn().mockResolvedValue(undefined),
        findMany: vi.fn().mockResolvedValue([])
      },
      assignmentStageTransition: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue(undefined)
      },
      assignmentSignal: {
        findMany: vi.fn().mockResolvedValue([])
      },
      assignmentTask: {
        findMany: vi.fn().mockResolvedValue([])
      },
      task: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'task-qc-1'
        })
      },
      membership: {
        findFirst: vi.fn().mockResolvedValue({
          userId: '33333333-3333-3333-3333-333333333333'
        })
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
    const billingService = createBillingServiceMock();
    billingService.addUsageLineForFinalize
      .mockResolvedValueOnce({
        invoice: {
          id: 'invoice-1',
          tenantId: 'tenant-1',
          periodStart: new Date('2026-02-01T00:00:00.000Z'),
          periodEnd: new Date('2026-03-01T00:00:00.000Z'),
          status: 'open',
          currency: 'INR',
          subtotalPaise: BigInt(0),
          taxPaise: BigInt(0),
          totalPaise: BigInt(0),
          issuedAt: null,
          paidAt: null,
          createdAt: new Date('2026-02-11T00:00:00.000Z'),
          updatedAt: new Date('2026-02-11T00:00:00.000Z')
        },
        usageEvent: {
          id: 'usage-1',
          unitPricePaise: 0,
          amountPaise: BigInt(0),
          units: 1
        },
        invoiceLine: {
          id: 'line-1',
          amountPaise: BigInt(0),
          unitPricePaise: 0,
          qty: 1
        },
        createdUsageEvent: true,
        createdInvoiceLine: true
      })
      .mockResolvedValueOnce({
        invoice: {
          id: 'invoice-1',
          tenantId: 'tenant-1',
          periodStart: new Date('2026-02-01T00:00:00.000Z'),
          periodEnd: new Date('2026-03-01T00:00:00.000Z'),
          status: 'open',
          currency: 'INR',
          subtotalPaise: BigInt(0),
          taxPaise: BigInt(0),
          totalPaise: BigInt(0),
          issuedAt: null,
          paidAt: null,
          createdAt: new Date('2026-02-11T00:00:00.000Z'),
          updatedAt: new Date('2026-02-11T00:00:00.000Z')
        },
        usageEvent: {
          id: 'usage-1',
          unitPricePaise: 0,
          amountPaise: BigInt(0),
          units: 1
        },
        invoiceLine: {
          id: 'line-1',
          amountPaise: BigInt(0),
          unitPricePaise: 0,
          qty: 1
        },
        createdUsageEvent: false,
        createdInvoiceLine: false
      });
    const service = createService(billingService);

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
    expect(billingService.addUsageLineForFinalize).toHaveBeenCalledTimes(2);
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

describe('DomainService billing gates', () => {
  it('blocks non-studio users from marking invoice paid', async () => {
    const billingService = createBillingServiceMock();
    const service = createService(billingService);

    await expect(service.markBillingInvoicePaid({} as any, webClaims, 'invoice-1', {})).rejects.toThrow(
      'BILLING_WRITE_FORBIDDEN'
    );
    expect(billingService.markInvoicePaid).not.toHaveBeenCalled();
  });

  it('allows studio billing:write capability to mark invoice paid', async () => {
    const billingService = createBillingServiceMock();
    const notificationsService = createNotificationsServiceMock();
    const service = createService(billingService, notificationsService);
    const studioClaims = {
      ...webClaims,
      aud: 'studio' as const,
      capabilities: ['billing:write']
    };

    await service.markBillingInvoicePaid({} as any, studioClaims, 'invoice-1', {
      amount_paise: 12345,
      reference: 'manual-ref'
    });

    expect(billingService.markInvoicePaid).toHaveBeenCalledWith({} as any, webClaims.tenant_id, 'invoice-1', {
      amount_paise: 12345,
      reference: 'manual-ref',
      notes: undefined,
      actor_user_id: webClaims.user_id
    });
    expect(notificationsService.enqueueEvent).toHaveBeenCalledWith(
      {} as any,
      expect.objectContaining({
        eventType: 'invoice_paid',
        idempotencyKey: 'invoice_paid:invoice-1'
      })
    );
  });
});

describe('DomainService assignment spine', () => {
  it('create assignment writes created activity', async () => {
    const notificationsService = createNotificationsServiceMock();
    const service = createService(createBillingServiceMock(), notificationsService);
    const { tx } = buildAssignmentGraphTx();

    const created = await service.createAssignment(tx, webClaims, {
      source: 'tenant',
      source_type: 'direct',
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
    expect(notificationsService.enqueueEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventType: 'assignment_created',
        idempotencyKey: 'assignment_created:assignment-1'
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
      source_type: 'direct',
      work_order_id: 'work-order-1',
      title: 'From Work Order',
      priority: 'high',
      status: 'requested'
    });

    await service.createAssignment(tx, webClaims, {
      source: 'external_portal',
      source_type: 'direct',
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

  it('lifecycle transition logs history and stage transition', async () => {
    const service = createService();
    const { tx } = buildAssignmentGraphTx();
    const claims = {
      ...webClaims,
      capabilities: ['assignments.transition']
    };

    await service.changeAssignmentStatus(
      tx,
      claims,
      'assignment-1',
      {
        to_status: 'COLLECTING',
        note: 'field docs started'
      },
      'req-transition-1'
    );

    expect(tx.assignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'assignment-1' },
        data: expect.objectContaining({ stage: 'data_collected' })
      })
    );
    expect(tx.assignmentStageTransition.create).toHaveBeenCalledTimes(1);
    expect(tx.assignmentStatusHistory.create).toHaveBeenCalledTimes(1);
  });

  it('rejects illegal lifecycle transitions', async () => {
    const service = createService();
    const { tx } = buildAssignmentGraphTx();
    const claims = {
      ...webClaims,
      capabilities: ['assignments.transition']
    };

    await expect(
      service.changeAssignmentStatus(
        tx,
        claims,
        'assignment-1',
        {
          to_status: 'QC_PENDING'
        },
        'req-transition-2'
      )
    ).rejects.toThrow('ILLEGAL_STAGE_TRANSITION');
  });

  it('creates one QC review task when entering QC_PENDING', async () => {
    const service = createService();
    const { tx } = buildAssignmentGraphTx();
    const claims = {
      ...webClaims,
      capabilities: ['assignments.transition']
    };

    await service.changeAssignmentStatus(
      tx,
      claims,
      'assignment-1',
      {
        to_status: 'COLLECTING'
      },
      'req-transition-3'
    );
    await service.changeAssignmentStatus(
      tx,
      claims,
      'assignment-1',
      {
        to_status: 'QC_PENDING'
      },
      'req-transition-4'
    );
    await service.changeAssignmentStatus(
      tx,
      claims,
      'assignment-1',
      {
        to_status: 'QC_PENDING'
      },
      'req-transition-5'
    );

    expect(tx.task.create).toHaveBeenCalledTimes(1);
    expect(tx.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assignmentId: 'assignment-1',
          title: 'QC review',
          status: 'open',
          priority: 'high'
        })
      })
    );
  });
});

describe('DomainService channel request review guard', () => {
  it('blocks portal user from accepting/rejecting channel requests', async () => {
    const service = createService();
    await expect(
      service.updateChannelRequestStatus(
        {} as any,
        {
          ...webClaims,
          aud: 'portal',
          tenant_id: '22222222-2222-2222-2222-222222222222'
        },
        'request-1',
        { status: 'ACCEPTED' }
      )
    ).rejects.toThrow('PORTAL_REQUEST_REVIEW_FORBIDDEN');
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
          size_bytes: 1024,
          classification: 'other',
          sensitivity: 'internal'
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
          size_bytes: 1024,
          classification: 'other',
          sensitivity: 'internal'
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

describe('DomainService people M4.2', () => {
  it('blocks payroll list without payroll.read capability', async () => {
    const service = createService();
    await expect(service.listPayrollPeriods({} as any, webClaims)).rejects.toThrow('MISSING_CAPABILITY:payroll.read');
  });

  it('blocks notification route writes without notifications.routes.write capability', async () => {
    const service = createService();
    await expect(
      service.createNotificationRoute({} as any, webClaims, {
        group_key: 'FINANCE',
        group_name: 'Finance Team',
        channel: 'email',
        to_contact_point_id: 'contact-1',
        is_active: true
      })
    ).rejects.toThrow('MISSING_CAPABILITY:notifications.routes.write');
  });

  it('does not duplicate attendance events for same request id', async () => {
    const service = createService();
    let stored: any = null;
    const attendanceClaims = {
      ...webClaims,
      capabilities: ['attendance.write']
    };

    const tx = {
      employee: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'employee-1',
          tenantId: '11111111-1111-1111-1111-111111111111',
          status: 'active',
          deletedAt: null
        })
      },
      attendanceEvent: {
        findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
          if (stored && where?.requestId === stored.requestId) {
            return stored;
          }
          return null;
        }),
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          stored = {
            id: 'attendance-1',
            tenantId: data.tenantId,
            employeeId: data.employeeId,
            kind: data.kind,
            source: data.source,
            happenedAt: data.happenedAt,
            metaJson: data.metaJson,
            requestId: data.requestId,
            createdByUserId: data.createdByUserId,
            createdAt: new Date('2026-02-12T09:00:00.000Z'),
            updatedAt: new Date('2026-02-12T09:00:00.000Z')
          };
          return stored;
        })
      }
    } as any;

    const first = await service.markAttendance(tx, attendanceClaims, 'req-att-1', 'checkin', {
      employee_id: 'employee-1',
      source: 'web'
    });
    const second = await service.markAttendance(tx, attendanceClaims, 'req-att-1', 'checkin', {
      employee_id: 'employee-1',
      source: 'web'
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(tx.attendanceEvent.create).toHaveBeenCalledTimes(1);
  });
});
