import { describe, expect, it, vi } from 'vitest';
import { createJsonLogger } from '@zenops/common';
import { processNotificationJob } from './notifications.processor.js';

const makeTx = (provider: 'noop' | 'sendgrid' = 'noop') => {
  const state = {
    outbox: {
      id: 'outbox-1',
      tenantId: 'tenant-1',
      channel: 'email',
      provider,
      templateKey: 'assignment_created',
      payloadJson: { assignment_id: 'assignment-1' },
      status: 'queued',
      providerMessageId: null as string | null,
      sentAt: null as Date | null,
      toContactPoint: {
        kind: 'email',
        value: 'ops@zenops.local'
      }
    },
    attempts: [] as Array<Record<string, unknown>>
  };

  return {
    state,
    tx: {
      notificationOutbox: {
        findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
          if (where?.id !== state.outbox.id || where?.tenantId !== state.outbox.tenantId) {
            return null;
          }
          return state.outbox;
        }),
        update: vi.fn().mockImplementation(async ({ data }: any) => {
          state.outbox = {
            ...state.outbox,
            ...data
          };
          return state.outbox;
        })
      },
      notificationAttempt: {
        count: vi.fn().mockImplementation(async () => state.attempts.length),
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          state.attempts.push(data);
          return data;
        })
      }
    } as any
  };
};

describe('processNotificationJob', () => {
  it('processes noop outbox item to sent status', async () => {
    const { tx, state } = makeTx();

    await processNotificationJob({
      prisma: {} as any,
      logger: createJsonLogger(),
      payload: {
        outboxId: 'outbox-1',
        tenantId: 'tenant-1',
        requestId: 'req-1'
      },
      fallbackTenantId: 'tenant-1',
      runWithContext: async (_prisma, _ctx, fn) => fn(tx)
    });

    expect(state.outbox.status).toBe('sent');
    expect(state.outbox.sentAt).toBeInstanceOf(Date);
    expect(state.outbox.providerMessageId).toContain('noop:outbox-1');
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]?.status).toBe('sent');
  });

  it('marks non-noop provider as failed when provider secrets are missing', async () => {
    const { tx, state } = makeTx('sendgrid');
    delete process.env.SENDGRID_API_KEY;

    await expect(
      processNotificationJob({
        prisma: {} as any,
        logger: createJsonLogger(),
        payload: {
          outboxId: 'outbox-1',
          tenantId: 'tenant-1',
          requestId: 'req-2'
        },
        fallbackTenantId: 'tenant-1',
        runWithContext: async (_prisma, _ctx, fn) => fn(tx)
      })
    ).rejects.toThrow('SENDGRID_API_KEY is not configured');

    expect(state.outbox.status).toBe('failed');
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]?.status).toBe('failed');
  });
});
