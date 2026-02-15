import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { BillingControlService } from './billing-control.service.js';

interface MockState {
  account: {
    id: string;
    tenantId: string;
    accountType: 'tenant' | 'external_associate';
    externalKey: string;
    displayName: string;
    status: 'active' | 'suspended';
    defaultPaymentTermsDays: number;
  };
  policy: {
    accountId: string;
    tenantId: string;
    billingMode: 'postpaid' | 'credit';
    paymentTermsDays: number;
    creditCostModel: 'flat';
    currency: string;
    isEnabled: boolean;
  };
  balance: {
    wallet: number;
    reserved: number;
    available: number;
  };
  reservations: Array<{
    id: string;
    tenantId: string;
    accountId: string;
    refType: string;
    refId: string;
    amount: number;
    status: 'active' | 'consumed' | 'released';
    idempotencyKey: string;
    createdAt: Date;
    consumedAt: Date | null;
    releasedAt: Date | null;
  }>;
  ledger: Array<{
    id: string;
    tenantId: string;
    accountId: string;
    reservationId: string | null;
    delta: number;
    reason: 'grant' | 'topup' | 'reserve' | 'consume' | 'release' | 'adjustment';
    refType: string | null;
    refId: string | null;
    idempotencyKey: string;
    metadataJson: Record<string, unknown>;
    createdAt: Date;
  }>;
  usageEvents: Array<{
    id: string;
    sourceSystem: 'v1' | 'v2';
    idempotencyKey: string;
  }>;
  channelRequests: Array<{
    id: string;
    tenantId: string;
    status: 'submitted' | 'accepted' | 'rejected';
    assignmentId: string | null;
    serviceInvoiceId: string | null;
  }>;
  assignments: Array<{
    id: string;
    status: 'requested' | 'in_progress' | 'delivered' | 'cancelled';
  }>;
}

const createState = (wallet = 2): MockState => ({
  account: {
    id: 'acc-1',
    tenantId: '11111111-1111-1111-1111-111111111111',
    accountType: 'external_associate',
    externalKey: 'v1:partner:10',
    displayName: 'Partner 10',
    status: 'active',
    defaultPaymentTermsDays: 15
  },
  policy: {
    accountId: 'acc-1',
    tenantId: '11111111-1111-1111-1111-111111111111',
    billingMode: 'credit',
    paymentTermsDays: 15,
    creditCostModel: 'flat',
    currency: 'INR',
    isEnabled: true
  },
  balance: {
    wallet,
    reserved: 0,
    available: wallet
  },
  reservations: [],
  ledger: [],
  usageEvents: [],
  channelRequests: [],
  assignments: []
});

const buildTx = (state: MockState) => {
  let reservationSeq = 0;
  let ledgerSeq = 0;
  let usageSeq = 0;

  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockImplementation(async () => [
      {
        walletBalance: state.balance.wallet,
        reservedBalance: state.balance.reserved,
        availableBalance: state.balance.available
      }
    ]),
    billingAccount: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where?.id && where.id !== state.account.id) return null;
        if (where?.externalKey && where.externalKey !== state.account.externalKey) return null;
        return state.account;
      })
    },
    billingPolicy: {
      upsert: vi.fn().mockImplementation(async ({ update }: any) => {
        const cleanUpdate = Object.fromEntries(
          Object.entries(update ?? {}).filter(([, value]) => value !== undefined)
        );
        state.policy = {
          ...state.policy,
          ...cleanUpdate
        };
        return state.policy;
      })
    },
    billingCreditBalance: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where.accountId !== state.account.id) return null;
        return {
          accountId: state.account.id,
          tenantId: state.account.tenantId,
          walletBalance: state.balance.wallet,
          reservedBalance: state.balance.reserved,
          availableBalance: state.balance.available
        };
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({
        accountId: data.accountId,
        tenantId: data.tenantId,
        walletBalance: data.walletBalance,
        reservedBalance: data.reservedBalance,
        availableBalance: data.availableBalance
      })),
      update: vi.fn().mockImplementation(async ({ data }: any) => {
        state.balance.wallet = data.walletBalance;
        state.balance.reserved = data.reservedBalance;
        state.balance.available = data.availableBalance;
        return {
          accountId: state.account.id,
          tenantId: state.account.tenantId,
          walletBalance: state.balance.wallet,
          reservedBalance: state.balance.reserved,
          availableBalance: state.balance.available
        };
      })
    },
    billingCreditReservation: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        const key = where?.accountId_idempotencyKey;
        if (!key) return null;
        return (
          state.reservations.find(
            (row) => row.accountId === key.accountId && row.idempotencyKey === key.idempotencyKey
          ) ?? null
        );
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where?.id) {
          return (
            state.reservations.find((row) => row.id === where.id && row.accountId === where.accountId) ?? null
          );
        }

        return (
          state.reservations.find(
            (row) =>
              row.accountId === where.accountId &&
              (where.refType ? row.refType === where.refType : true) &&
              (where.refId ? row.refId === where.refId : true)
          ) ?? null
        );
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        reservationSeq += 1;
        const row = {
          id: `res-${reservationSeq}`,
          tenantId: data.tenantId,
          accountId: data.accountId,
          refType: data.refType,
          refId: data.refId,
          amount: data.amount,
          status: data.status,
          idempotencyKey: data.idempotencyKey,
          createdAt: new Date(),
          consumedAt: null,
          releasedAt: null
        } as const;
        state.reservations.unshift({ ...row });
        return row;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const row = state.reservations.find((item) => item.id === where.id);
        if (!row) throw new Error('reservation not found');
        Object.assign(row, data);
        return row;
      }),
      aggregate: vi.fn().mockImplementation(async ({ where }: any) => {
        const amount = state.reservations
          .filter((row) => row.accountId === where.accountId && row.status === where.status)
          .reduce((sum, row) => sum + row.amount, 0);
        return { _sum: { amount } };
      }),
      findMany: vi.fn().mockImplementation(async ({ where, take }: any = {}) => {
        const filtered = state.reservations.filter((row) => {
          if (where?.status && row.status !== where.status) return false;
          if (where?.tenantId && row.tenantId !== where.tenantId) return false;
          if (where?.refType && row.refType !== where.refType) return false;
          if (where?.accountId && row.accountId !== where.accountId) return false;
          return true;
        });
        return filtered.slice(0, take ?? filtered.length);
      })
    },
    billingCreditLedger: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        const key = where?.accountId_idempotencyKey;
        if (!key) return null;
        return state.ledger.find((row) => row.accountId === key.accountId && row.idempotencyKey === key.idempotencyKey) ?? null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        ledgerSeq += 1;
        const row = {
          id: `led-${ledgerSeq}`,
          tenantId: data.tenantId,
          accountId: data.accountId,
          reservationId: data.reservationId ?? null,
          delta: data.delta,
          reason: data.reason,
          refType: data.refType ?? null,
          refId: data.refId ?? null,
          idempotencyKey: data.idempotencyKey,
          metadataJson: data.metadataJson ?? {},
          createdAt: new Date()
        };
        state.ledger.unshift(row);
        return row;
      }),
      aggregate: vi.fn().mockImplementation(async ({ where }: any) => {
        const sum = state.ledger
          .filter((row) => {
            if (row.accountId !== where.accountId) return false;
            const reasons: string[] | undefined = where.reason?.in;
            return reasons ? reasons.includes(row.reason) : true;
          })
          .reduce((total, row) => total + row.delta, 0);
        return { _sum: { delta: sum } };
      }),
      findMany: vi.fn().mockImplementation(async () => state.ledger)
    },
    billingUsageEvent: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        const key = where?.sourceSystem_idempotencyKey;
        if (!key) return null;
        return (
          state.usageEvents.find(
            (row) => row.sourceSystem === key.sourceSystem && row.idempotencyKey === key.idempotencyKey
          ) ?? null
        );
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        usageSeq += 1;
        const row = {
          id: `evt-${usageSeq}`,
          sourceSystem: data.sourceSystem,
          idempotencyKey: data.idempotencyKey
        };
        state.usageEvents.unshift(row);
        return {
          ...row,
          tenantId: data.tenantId,
          eventType: data.eventType,
          accountId: data.accountId,
          externalAccountKey: data.externalAccountKey,
          payloadJson: data.payloadJson,
          createdAt: new Date()
        };
      }),
      findMany: vi.fn().mockImplementation(async () => [])
    },
    channelRequest: {
      findMany: vi.fn().mockImplementation(async ({ where }: any) => {
        const ids: string[] | undefined = where?.id?.in;
        if (!ids) return [];
        return state.channelRequests.filter((row) => ids.includes(row.id));
      })
    },
    assignment: {
      findMany: vi.fn().mockImplementation(async ({ where }: any) => {
        const ids: string[] | undefined = where?.id?.in;
        if (!ids) return [];
        return state.assignments.filter((row) => ids.includes(row.id));
      })
    },
    serviceInvoice: {
      findMany: vi.fn().mockResolvedValue([])
    }
  };

  return tx as any;
};

describe('BillingControlService credit lifecycle', () => {
  it('is idempotent for repeated reserve with same key', async () => {
    const service = new BillingControlService();
    const state = createState(2);
    const tx = buildTx(state);

    const first = await service.reserveCredits(tx, {
      account_id: state.account.id,
      amount: 1,
      ref_type: 'channel_request',
      ref_id: 'cr-1',
      idempotency_key: 'reserve-1'
    });

    const second = await service.reserveCredits(tx, {
      account_id: state.account.id,
      amount: 1,
      ref_type: 'channel_request',
      ref_id: 'cr-1',
      idempotency_key: 'reserve-1'
    });

    expect(first.id).toBe(second.id);
    expect(state.reservations.length).toBe(1);
    expect(state.balance.wallet).toBe(2);
    expect(state.balance.reserved).toBe(1);
    expect(state.balance.available).toBe(1);
  });

  it('reserve then consume updates wallet/reserved/available correctly', async () => {
    const service = new BillingControlService();
    const state = createState(3);
    const tx = buildTx(state);

    const reservation = await service.reserveCredits(tx, {
      account_id: state.account.id,
      amount: 2,
      ref_type: 'channel_request',
      ref_id: 'cr-2',
      idempotency_key: 'reserve-2'
    });

    await service.consumeCredits(tx, {
      account_id: state.account.id,
      reservation_id: reservation.id,
      idempotency_key: 'consume-2'
    });

    expect(state.balance.wallet).toBe(1);
    expect(state.balance.reserved).toBe(0);
    expect(state.balance.available).toBe(1);
  });

  it('reserve then release returns reserved balance to available', async () => {
    const service = new BillingControlService();
    const state = createState(2);
    const tx = buildTx(state);

    const reservation = await service.reserveCredits(tx, {
      account_id: state.account.id,
      amount: 1,
      ref_type: 'channel_request',
      ref_id: 'cr-3',
      idempotency_key: 'reserve-3'
    });

    await service.releaseCredits(tx, {
      account_id: state.account.id,
      reservation_id: reservation.id,
      idempotency_key: 'release-3'
    });

    expect(state.balance.wallet).toBe(2);
    expect(state.balance.reserved).toBe(0);
    expect(state.balance.available).toBe(2);
  });

  it('rejects reserve when credits are insufficient', async () => {
    const service = new BillingControlService();
    const state = createState(0);
    const tx = buildTx(state);

    await expect(
      service.reserveCredits(tx, {
        account_id: state.account.id,
        amount: 1,
        ref_type: 'channel_request',
        ref_id: 'cr-4',
        idempotency_key: 'reserve-4'
      })
    ).rejects.toThrowError(ConflictException);
  });

  it('prevents release after consume', async () => {
    const service = new BillingControlService();
    const state = createState(2);
    const tx = buildTx(state);

    const reservation = await service.reserveCredits(tx, {
      account_id: state.account.id,
      amount: 1,
      ref_type: 'channel_request',
      ref_id: 'cr-5',
      idempotency_key: 'reserve-5'
    });

    await service.consumeCredits(tx, {
      account_id: state.account.id,
      reservation_id: reservation.id,
      idempotency_key: 'consume-5'
    });

    await expect(
      service.releaseCredits(tx, {
        account_id: state.account.id,
        reservation_id: reservation.id,
        idempotency_key: 'release-5'
      })
    ).rejects.toThrowError(ConflictException);
  });

  it('reconcile consumes delivered reservations and releases cancelled ones', async () => {
    const service = new BillingControlService();
    const state = createState(5);
    const tx = buildTx(state);

    const delivered = await service.reserveCredits(tx, {
      account_id: state.account.id,
      amount: 1,
      ref_type: 'channel_request',
      ref_id: 'cr-delivered',
      idempotency_key: 'reserve-delivered'
    });
    const cancelled = await service.reserveCredits(tx, {
      account_id: state.account.id,
      amount: 1,
      ref_type: 'channel_request',
      ref_id: 'cr-cancelled',
      idempotency_key: 'reserve-cancelled'
    });

    state.channelRequests.push(
      {
        id: 'cr-delivered',
        tenantId: state.account.tenantId,
        status: 'accepted',
        assignmentId: 'asn-delivered',
        serviceInvoiceId: null
      },
      {
        id: 'cr-cancelled',
        tenantId: state.account.tenantId,
        status: 'accepted',
        assignmentId: 'asn-cancelled',
        serviceInvoiceId: null
      }
    );
    state.assignments.push(
      { id: 'asn-delivered', status: 'delivered' },
      { id: 'asn-cancelled', status: 'cancelled' }
    );

    const result = await service.reconcileCredits(tx, {
      tenant_id: state.account.tenantId,
      limit: 20
    });

    expect(result.consumed).toBe(1);
    expect(result.released).toBe(1);
    expect(result.errors).toHaveLength(0);

    const deliveredRow = state.reservations.find((row) => row.id === delivered.id);
    const cancelledRow = state.reservations.find((row) => row.id === cancelled.id);
    expect(deliveredRow?.status).toBe('consumed');
    expect(cancelledRow?.status).toBe('released');
    expect(state.balance.wallet).toBe(4);
    expect(state.balance.reserved).toBe(0);
    expect(state.balance.available).toBe(4);
  });

  it('reconcile dry-run reports actions without mutating reservations', async () => {
    const service = new BillingControlService();
    const state = createState(3);
    const tx = buildTx(state);

    const reservation = await service.reserveCredits(tx, {
      account_id: state.account.id,
      amount: 1,
      ref_type: 'channel_request',
      ref_id: 'cr-dry',
      idempotency_key: 'reserve-dry'
    });

    state.channelRequests.push({
      id: 'cr-dry',
      tenantId: state.account.tenantId,
      status: 'accepted',
      assignmentId: 'asn-dry',
      serviceInvoiceId: null
    });
    state.assignments.push({ id: 'asn-dry', status: 'delivered' });

    const before = state.reservations.find((row) => row.id === reservation.id)?.status;
    const result = await service.reconcileCredits(tx, {
      tenant_id: state.account.tenantId,
      dry_run: true
    });
    const after = state.reservations.find((row) => row.id === reservation.id)?.status;

    expect(result.dry_run).toBe(true);
    expect(result.consumed).toBe(1);
    expect(result.released).toBe(0);
    expect(before).toBe('active');
    expect(after).toBe('active');
  });
});
