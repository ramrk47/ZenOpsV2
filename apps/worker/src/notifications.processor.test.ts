import { describe, expect, it, vi } from 'vitest';
import { createJsonLogger } from '@zenops/common';
import { processNotificationJob } from './notifications.processor.js';

const makeTx = (provider: 'noop' | 'sendgrid' | 'mailgun' | 'twilio' = 'noop', channel: 'email' | 'whatsapp' = 'email') => {
  const state = {
    outbox: {
      id: 'outbox-1',
      tenantId: 'tenant-1',
      channel,
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

  it('marks mailgun send as failed when email provider is enabled but secrets are missing', async () => {
    const { tx, state } = makeTx('noop', 'email');
    process.env.NOTIFY_PROVIDER_EMAIL = 'mailgun';
    delete process.env.MAILGUN_API_KEY;
    delete process.env.MAILGUN_DOMAIN;
    delete process.env.MAILGUN_FROM;

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
    ).rejects.toThrow('MAILGUN_API_KEY/MAILGUN_DOMAIN/MAILGUN_FROM are required');

    expect(state.outbox.status).toBe('failed');
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]?.status).toBe('failed');

    delete process.env.NOTIFY_PROVIDER_EMAIL;
  });

  it('marks twilio whatsapp send as failed when secrets are missing', async () => {
    const { tx, state } = makeTx('noop', 'whatsapp');
    process.env.NOTIFY_PROVIDER_WHATSAPP = 'twilio';
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_WHATSAPP_FROM;

    await expect(
      processNotificationJob({
        prisma: {} as any,
        logger: createJsonLogger(),
        payload: {
          outboxId: 'outbox-1',
          tenantId: 'tenant-1',
          requestId: 'req-3'
        },
        fallbackTenantId: 'tenant-1',
        runWithContext: async (_prisma, _ctx, fn) => fn(tx)
      })
    ).rejects.toThrow('TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_WHATSAPP_FROM are required');

    expect(state.outbox.status).toBe('failed');
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]?.status).toBe('failed');

    delete process.env.NOTIFY_PROVIDER_WHATSAPP;
  });
});
