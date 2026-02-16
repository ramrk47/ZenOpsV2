import { Prisma } from '@zenops/db';
import { describe, expect, it, vi } from 'vitest';
import { BillingControlService } from './billing-control.service.js';

const buildSubscriptionTx = (subscriptionOverrides: Partial<any> = {}) => {
  const subscription = {
    id: 'sub-1',
    tenantId: '11111111-1111-1111-1111-111111111111',
    accountId: 'acc-1',
    status: 'active',
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
    nextRefillAt: new Date('2026-01-02T00:00:00.000Z'),
    plan: {
      monthlyCreditAllowance: 5,
      cycleDays: 30
    },
    account: {
      id: 'acc-1'
    },
    ...subscriptionOverrides
  };

  const events = new Map<string, { requestHash: string; responseJson?: Record<string, unknown> }>();
  const eventRows = new Map<string, any>();

  const tx = {
    billingSubscription: {
      findFirst: vi.fn().mockResolvedValue(subscription),
      findMany: vi.fn().mockImplementation(async ({ where }: any) => {
        const statusFilter = where?.status;
        const matchesStatus = Array.isArray(statusFilter?.in)
          ? statusFilter.in.includes(subscription.status)
          : statusFilter
            ? subscription.status === statusFilter
            : true;
        const cutoff = where?.nextRefillAt?.lte as Date | undefined;
        const matchesDue = cutoff ? subscription.nextRefillAt <= cutoff : true;
        return matchesStatus && matchesDue ? [subscription] : [];
      }),
      update: vi.fn().mockImplementation(async ({ data }: any) => {
        Object.assign(subscription, data);
        return subscription;
      })
    },
    billingSubscriptionEvent: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        const key = `${where.provider_idempotencyKey.provider}:${where.provider_idempotencyKey.idempotencyKey}`;
        return eventRows.get(key) ?? null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const key = `${data.provider}:${data.idempotencyKey}`;
        const row = {
          id: `evt-${eventRows.size + 1}`,
          ...data
        };
        eventRows.set(key, row);
        return row;
      })
    }
  };

  return {
    tx: tx as any,
    subscription,
    events,
    eventRows
  };
};

describe('BillingControlService M5.1 subscriptions', () => {
  it('refill is idempotent for repeated idempotency key', async () => {
    const service = new BillingControlService();
    const { tx } = buildSubscriptionTx();
    const grantSpy = vi.spyOn(service, 'grantCredits').mockResolvedValue({} as any);

    const first = await service.refillSubscription(tx, 'sub-1', {
      idempotency_key: 'refill:sub-1:2026-01-01'
    });
    const second = await service.refillSubscription(tx, 'sub-1', {
      idempotency_key: 'refill:sub-1:2026-01-01'
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(grantSpy).toHaveBeenCalledTimes(1);
  });

  it('refill is skipped when subscription is not active', async () => {
    const service = new BillingControlService();
    const { tx } = buildSubscriptionTx({ status: 'paused' });
    const grantSpy = vi.spyOn(service, 'grantCredits').mockResolvedValue({} as any);

    const result = await service.refillSubscription(tx, 'sub-1', {
      idempotency_key: 'refill:paused'
    });

    expect(result.status).toBe('skipped_inactive');
    expect(grantSpy).not.toHaveBeenCalled();
  });

  it('refill advances period boundaries and next_refill_at', async () => {
    const service = new BillingControlService();
    const { tx } = buildSubscriptionTx();
    vi.spyOn(service, 'grantCredits').mockResolvedValue({} as any);

    await service.refillSubscription(tx, 'sub-1', {
      idempotency_key: 'refill:advance'
    });

    const updateCall = tx.billingSubscription.update.mock.calls.at(0)?.[0];
    const nextStart = updateCall.data.currentPeriodStart as Date;
    const nextEnd = updateCall.data.currentPeriodEnd as Date;

    expect(nextStart.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(nextEnd.toISOString()).toBe('2026-03-03T00:00:00.000Z');
    expect(updateCall.data.nextRefillAt.toISOString()).toBe('2026-03-03T00:00:00.000Z');
  });

  it('due refill processing only includes active subscriptions that are due', async () => {
    const service = new BillingControlService();
    const { tx } = buildSubscriptionTx({
      status: 'active',
      nextRefillAt: new Date('2026-01-01T00:00:00.000Z')
    });
    const grantSpy = vi.spyOn(service, 'grantCredits').mockResolvedValue({} as any);

    const result = await service.processDueSubscriptionRefills(tx, {
      limit: 50
    });

    expect(result.scanned).toBe(1);
    expect(result.refilled).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(grantSpy).toHaveBeenCalledTimes(1);
  });
});

describe('BillingControlService M5.1 invoice payment idempotency', () => {
  it('mark-paid style retries with same idempotency key create one payment effect', async () => {
    const service = new BillingControlService();

    const paymentRows: Array<{ id: string }> = [];
    const idempotency = new Map<string, { requestHash: string; responseJson: Record<string, unknown> }>();

    const tx = {
      serviceInvoice: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inv-1',
          tenantId: '11111111-1111-1111-1111-111111111111',
          accountId: 'acc-1',
          status: 'issued',
          amountDue: new Prisma.Decimal(100)
        })
      },
      serviceIdempotencyKey: {
        findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
          const key = `${where.accountId_scope_key.accountId}:${where.accountId_scope_key.scope}:${where.accountId_scope_key.key}`;
          const found = idempotency.get(key);
          if (!found) {
            return null;
          }
          return {
            ...found,
            accountId: where.accountId_scope_key.accountId,
            scope: where.accountId_scope_key.scope,
            key: where.accountId_scope_key.key
          };
        }),
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          const key = `${data.accountId}:${data.scope}:${data.key}`;
          idempotency.set(key, {
            requestHash: data.requestHash,
            responseJson: data.responseJson
          });
          return {
            id: `idem-${idempotency.size}`,
            ...data
          };
        }),
        update: vi.fn().mockImplementation(async ({ where, data }: any) => {
          const key = `${where.accountId_scope_key.accountId}:${where.accountId_scope_key.scope}:${where.accountId_scope_key.key}`;
          const found = idempotency.get(key);
          if (found) {
            found.responseJson = data.responseJson;
          }
          return {
            id: `idem-update-${where.accountId_scope_key.key}`,
            ...where,
            ...data
          };
        })
      },
      serviceInvoicePayment: {
        create: vi.fn().mockImplementation(async () => {
          const row = {
            id: `pay-${paymentRows.length + 1}`
          };
          paymentRows.push(row);
          return row;
        })
      }
    } as any;

    vi.spyOn(service as any, 'recomputeServiceInvoice').mockResolvedValue({ status: 'paid' });
    vi.spyOn(service as any, 'addInvoiceAudit').mockResolvedValue(undefined);
    vi.spyOn(service, 'ingestUsageEvent').mockResolvedValue({} as any);
    vi.spyOn(service, 'getServiceInvoice').mockResolvedValue({
      id: 'inv-1',
      status: 'PAID',
      amount_due: 0,
      amount_paid: 100
    } as any);

    const first = await service.addServiceInvoicePayment(
      tx,
      '11111111-1111-1111-1111-111111111111',
      'inv-1',
      null,
      {
        amount: 100,
        mode: 'manual',
        reference: 'proof-1'
      },
      'idem-mark-paid'
    );

    const second = await service.addServiceInvoicePayment(
      tx,
      '11111111-1111-1111-1111-111111111111',
      'inv-1',
      null,
      {
        amount: 100,
        mode: 'manual',
        reference: 'proof-1'
      },
      'idem-mark-paid'
    );

    expect(first.status).toBe('PAID');
    expect(second.status).toBe('PAID');
    expect(tx.serviceInvoicePayment.create).toHaveBeenCalledTimes(1);
  });
});
