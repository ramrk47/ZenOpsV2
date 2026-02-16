import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@zenops/db';
import { BillingControlService } from './billing-control.service.js';

describe('BillingControlService M5.2 payment webhook idempotency', () => {
  it('returns duplicate=true and skips side-effects when provider event already exists', async () => {
    const service = new BillingControlService();
    const tx = {
      paymentEvent: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'evt-existing',
          processedAt: new Date()
        })
      }
    } as any;

    const result = await service.ingestPaymentWebhook(tx, {
      provider: 'stripe',
      event_id: 'evt_123',
      event_type: 'checkout.session.completed',
      signature_ok: true,
      payload_json: {
        id: 'evt_123'
      },
      payload_hash: 'hash'
    });

    expect(result.duplicate).toBe(true);
    expect(result.processed).toBe(true);
    expect(result.event_id).toBe('evt-existing');
  });

  it('processes a settled topup once even if webhook delivery is repeated', async () => {
    const service = new BillingControlService();
    const grantSpy = vi.spyOn(service, 'grantCredits').mockResolvedValue({} as any);
    const usageSpy = vi.spyOn(service, 'ingestUsageEvent').mockResolvedValue({} as any);

    const events = new Map<string, { id: string; processedAt: Date | null }>();
    const paymentOrder = {
      id: 'pay-1',
      tenantId: '11111111-1111-1111-1111-111111111111',
      accountId: 'acc-1',
      serviceInvoiceId: null,
      provider: 'stripe',
      purpose: 'topup',
      status: 'pending',
      amount: new Prisma.Decimal(100),
      creditsAmount: 10,
      providerOrderId: 'cs_test_123',
      providerPaymentId: null,
      checkoutUrl: 'https://checkout.example',
      settledAt: null
    };

    const tx = {
      paymentEvent: {
        findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
          const key = `${where.provider_eventId.provider}:${where.provider_eventId.eventId}`;
          return events.get(key) ?? null;
        }),
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          const key = `${data.provider}:${data.eventId}`;
          const row = {
            id: `evt-${events.size + 1}`,
            processedAt: null
          };
          events.set(key, row);
          return row;
        }),
        update: vi.fn().mockImplementation(async ({ where, data }: any) => {
          const event = Array.from(events.values()).find((row) => row.id === where.id);
          if (event) {
            event.processedAt = data.processedAt;
          }
          return {
            id: where.id,
            processedAt: data.processedAt
          };
        })
      },
      paymentOrder: {
        findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
          if (where?.id && where.id === paymentOrder.id) {
            return { ...paymentOrder, serviceInvoice: null };
          }
          if (where?.providerOrderId && where.providerOrderId === paymentOrder.providerOrderId) {
            return { ...paymentOrder, serviceInvoice: null };
          }
          if (where?.providerPaymentId && where.providerPaymentId === paymentOrder.providerPaymentId) {
            return { ...paymentOrder, serviceInvoice: null };
          }
          return null;
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockImplementation(async ({ data }: any) => {
          Object.assign(paymentOrder, data);
          return { ...paymentOrder, serviceInvoice: null };
        })
      },
      invoicePaymentLink: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 })
      }
    } as any;

    const first = await service.ingestPaymentWebhook(tx, {
      provider: 'stripe',
      event_id: 'evt_topup_1',
      event_type: 'checkout.session.completed',
      signature_ok: true,
      payload_json: {
        id: 'evt_topup_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123'
          }
        }
      },
      payload_hash: 'hash-1'
    });

    const second = await service.ingestPaymentWebhook(tx, {
      provider: 'stripe',
      event_id: 'evt_topup_1',
      event_type: 'checkout.session.completed',
      signature_ok: true,
      payload_json: {
        id: 'evt_topup_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123'
          }
        }
      },
      payload_hash: 'hash-1'
    });

    expect(first.duplicate).toBe(false);
    expect(first.processed).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(grantSpy).toHaveBeenCalledTimes(1);
    expect(usageSpy).toHaveBeenCalledTimes(1);
    expect(paymentOrder.status).toBe('paid');
  });
});
