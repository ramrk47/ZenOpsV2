import { describe, expect, it, vi } from 'vitest';
import { BillingService, getCalendarMonthlyPeriod } from './billing.service.js';

const nowIso = '2026-02-11T10:00:00.000Z';

const buildBillingTx = (options: { includedReports?: number; unitPricePaise?: number } = {}) => {
  const tenantId = 'tenant-1';
  const billingPlan = {
    id: 'plan-1',
    tenantId,
    code: 'launch-default',
    name: 'Launch Default',
    currency: 'INR',
    includedReports: options.includedReports ?? 10,
    unitPricePaise: options.unitPricePaise ?? 150000,
    createdAt: new Date(nowIso),
    updatedAt: new Date(nowIso)
  };

  const tenantBilling = {
    id: 'tenant-billing-1',
    tenantId,
    billingPlanId: billingPlan.id,
    status: 'active',
    billingEmail: null as string | null,
    currency: 'INR',
    taxRateBps: 0,
    createdAt: new Date(nowIso),
    updatedAt: new Date(nowIso),
    billingPlan
  };

  const state = {
    tenantBilling,
    billingPlan,
    usageEvents: [] as any[],
    invoices: [] as any[],
    invoiceLines: [] as any[],
    payments: [] as any[]
  };

  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    tenantBilling: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where?.tenantId === tenantId) {
          return { ...state.tenantBilling, billingPlan: state.billingPlan };
        }
        return null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        state.tenantBilling = {
          ...state.tenantBilling,
          ...data
        };
        return { ...state.tenantBilling, billingPlan: state.billingPlan };
      })
    },
    billingPlan: {
      upsert: vi.fn().mockImplementation(async ({ create }: any) => {
        state.billingPlan = {
          ...state.billingPlan,
          ...create
        };
        return state.billingPlan;
      })
    },
    usageEvent: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where?.reportRequestId_eventType) {
          return (
            state.usageEvents.find(
              (event) =>
                event.reportRequestId === where.reportRequestId_eventType.reportRequestId &&
                event.eventType === where.reportRequestId_eventType.eventType
            ) ?? null
          );
        }
        return null;
      }),
      count: vi.fn().mockImplementation(async ({ where }: any) => {
        return state.usageEvents.filter((event) => {
          const at = event.occurredAt.getTime();
          return (
            event.tenantId === where.tenantId &&
            event.eventType === where.eventType &&
            at >= where.occurredAt.gte.getTime() &&
            at < where.occurredAt.lt.getTime()
          );
        }).length;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const created = {
          id: `usage-${state.usageEvents.length + 1}`,
          tenantId: data.tenantId,
          billingPlanId: data.billingPlanId,
          reportRequestId: data.reportRequestId,
          assignmentId: data.assignmentId ?? null,
          eventType: data.eventType,
          units: data.units,
          idempotencyKey: data.idempotencyKey,
          unitPricePaise: data.unitPricePaise,
          amountPaise: data.amountPaise,
          occurredAt: data.occurredAt ?? new Date(nowIso),
          createdAt: new Date(nowIso),
          updatedAt: new Date(nowIso)
        };
        state.usageEvents.push(created);
        return created;
      })
    },
    invoice: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where?.tenantId_periodStart_periodEnd) {
          const key = where.tenantId_periodStart_periodEnd;
          return (
            state.invoices.find(
              (invoice) =>
                invoice.tenantId === key.tenantId &&
                invoice.periodStart.getTime() === key.periodStart.getTime() &&
                invoice.periodEnd.getTime() === key.periodEnd.getTime()
            ) ?? null
          );
        }
        return null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const created = {
          id: `invoice-${state.invoices.length + 1}`,
          tenantId: data.tenantId,
          tenantBillingId: data.tenantBillingId ?? null,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          status: data.status ?? 'open',
          currency: data.currency ?? 'INR',
          subtotalPaise: BigInt(0),
          taxPaise: BigInt(0),
          totalPaise: BigInt(0),
          issuedAt: null,
          paidAt: null,
          createdAt: new Date(nowIso),
          updatedAt: new Date(nowIso)
        };
        state.invoices.push(created);
        return created;
      }),
      findFirst: vi.fn().mockImplementation(async ({ where, include }: any) => {
        const row = state.invoices.find((invoice) => invoice.id === where.id) ?? null;
        if (!row) return null;
        if (include?.tenantBilling) {
          return {
            ...row,
            tenantBilling: { ...state.tenantBilling, billingPlan: state.billingPlan }
          };
        }
        if (include?.lines || include?.payments) {
          return {
            ...row,
            lines: include.lines ? state.invoiceLines.filter((line) => line.invoiceId === row.id) : undefined,
            payments: include.payments ? state.payments.filter((payment) => payment.invoiceId === row.id) : undefined
          };
        }
        return row;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: any) => {
        return state.invoices.filter((invoice) => invoice.tenantId === where.tenantId);
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const invoice = state.invoices.find((row) => row.id === where.id);
        if (!invoice) throw new Error(`invoice ${where.id} not found`);
        Object.assign(invoice, data, { updatedAt: new Date(nowIso) });
        return invoice;
      })
    },
    invoiceLine: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where?.usageEventId) {
          return state.invoiceLines.find((line) => line.usageEventId === where.usageEventId) ?? null;
        }
        return null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const created = {
          id: `line-${state.invoiceLines.length + 1}`,
          invoiceId: data.invoiceId,
          tenantId: data.tenantId,
          lineType: data.lineType,
          qty: data.qty,
          unitPricePaise: data.unitPricePaise,
          amountPaise: data.amountPaise,
          usageEventId: data.usageEventId,
          reportRequestId: data.reportRequestId ?? null,
          createdAt: new Date(nowIso),
          updatedAt: new Date(nowIso)
        };
        state.invoiceLines.push(created);
        return created;
      }),
      aggregate: vi.fn().mockImplementation(async ({ where }: any) => {
        const sum = state.invoiceLines
          .filter((line) => line.invoiceId === where.invoiceId)
          .reduce((total, line) => total + line.amountPaise, BigInt(0));
        return { _sum: { amountPaise: sum } };
      })
    },
    payment: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const created = { id: `payment-${state.payments.length + 1}`, ...data, createdAt: new Date(nowIso) };
        state.payments.push(created);
        return created;
      })
    }
  };

  return { tx, state };
};

describe('BillingService period boundaries', () => {
  it('computes month boundaries in Asia/Kolkata with exclusive end', () => {
    const period = getCalendarMonthlyPeriod(new Date('2026-03-31T20:30:00.000Z'));
    expect(period).toEqual({
      startDate: '2026-04-01',
      endDate: '2026-05-01'
    });
  });

  it('rolls year boundary correctly for December', () => {
    const period = getCalendarMonthlyPeriod(new Date('2026-12-15T00:00:00.000Z'));
    expect(period).toEqual({
      startDate: '2026-12-01',
      endDate: '2027-01-01'
    });
  });
});

describe('BillingService finalize usage billing', () => {
  it('is idempotent for repeated finalize calls on the same report request', async () => {
    const service = new BillingService();
    const { tx, state } = buildBillingTx({ includedReports: 10, unitPricePaise: 150000 });
    const now = new Date('2026-02-11T10:00:00.000Z');

    const first = await service.addUsageLineForFinalize(tx as any, {
      tenantId: 'tenant-1',
      reportRequestId: 'req-1',
      assignmentId: 'assignment-1',
      now
    });

    const second = await service.addUsageLineForFinalize(tx as any, {
      tenantId: 'tenant-1',
      reportRequestId: 'req-1',
      assignmentId: 'assignment-1',
      now
    });

    expect(first.createdUsageEvent).toBe(true);
    expect(first.createdInvoiceLine).toBe(true);
    expect(second.createdUsageEvent).toBe(false);
    expect(second.createdInvoiceLine).toBe(false);
    expect(state.usageEvents.length).toBe(1);
    expect(state.invoiceLines.length).toBe(1);
    expect(state.invoices.length).toBe(1);
  });

  it('charges only overage after included reports are consumed in the same month', async () => {
    const service = new BillingService();
    const { tx, state } = buildBillingTx({ includedReports: 1, unitPricePaise: 150000 });
    const now = new Date('2026-02-11T10:00:00.000Z');

    const first = await service.addUsageLineForFinalize(tx as any, {
      tenantId: 'tenant-1',
      reportRequestId: 'req-1',
      assignmentId: null,
      now
    });

    const second = await service.addUsageLineForFinalize(tx as any, {
      tenantId: 'tenant-1',
      reportRequestId: 'req-2',
      assignmentId: null,
      now
    });

    expect(first.invoiceLine.amountPaise).toBe(BigInt(0));
    expect(second.invoiceLine.amountPaise).toBe(BigInt(150000));
    expect(state.usageEvents[0].amountPaise).toBe(BigInt(0));
    expect(state.usageEvents[1].amountPaise).toBe(BigInt(150000));
    expect(second.invoice.totalPaise).toBe(BigInt(150000));
  });
});
