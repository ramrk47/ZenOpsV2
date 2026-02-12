import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service.js';

const buildTx = () => {
  const state = {
    contactPoints: [
      { id: 'cp-1', tenantId: 'tenant-1', kind: 'email', value: 'ops@zenops.local' },
      { id: 'cp-2', tenantId: 'tenant-1', kind: 'whatsapp', value: '+919999000111' }
    ],
    outbox: [] as Array<Record<string, any>>,
    attempts: [] as Array<Record<string, any>>,
    webhookEvents: [] as Array<Record<string, any>>
  };

  const tx = {
    contactPoint: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        return (
          state.contactPoints.find(
            (row) =>
              (!where.id || row.id === where.id) &&
              (!where.tenantId || row.tenantId === where.tenantId) &&
              (!where.kind || row.kind === where.kind) &&
              (!where.value || row.value === where.value)
          ) ?? null
        );
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const created = {
          id: `cp-${state.contactPoints.length + 1}`,
          ...data
        };
        state.contactPoints.push(created);
        return created;
      })
    },
    notificationTemplate: {
      findFirst: vi.fn().mockResolvedValue({ provider: 'noop' })
    },
    notificationTarget: {
      findMany: vi.fn().mockResolvedValue([])
    },
    notificationSubscription: {
      findMany: vi.fn().mockResolvedValue([])
    },
    notificationOutbox: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        return (
          state.outbox.find(
            (row) =>
              (!where.id || row.id === where.id) &&
              (!where.tenantId || row.tenantId === where.tenantId) &&
              (!where.status || row.status === where.status) &&
              (!where.idempotencyKey || row.idempotencyKey === where.idempotencyKey) &&
              (!where.providerMessageId || row.providerMessageId === where.providerMessageId)
          ) ?? null
        );
      }),
      count: vi.fn().mockImplementation(async ({ where }: any) => {
        return state.outbox.filter(
          (row) =>
            (!where?.tenantId || row.tenantId === where.tenantId) &&
            (!where?.status || row.status === where.status)
        ).length;
      }),
      findMany: vi.fn().mockImplementation(async () => state.outbox),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const created = {
          id: `outbox-${state.outbox.length + 1}`,
          providerMessageId: null,
          sentAt: null,
          queuedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
          toContactPoint:
            state.contactPoints.find((row) => row.id === data.toContactPointId) ?? state.contactPoints[0],
          attempts: []
        };
        state.outbox.push(created);
        return created;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const idx = state.outbox.findIndex((row) => row.id === where.id);
        state.outbox[idx] = {
          ...state.outbox[idx],
          ...data,
          updatedAt: new Date()
        };
        return state.outbox[idx];
      })
    },
    webhookEvent: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        return (
          state.webhookEvents.find(
            (row) => row.provider === where.provider && row.providerEventId === where.providerEventId
          ) ?? null
        );
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const created = {
          id: `webhook-${state.webhookEvents.length + 1}`,
          createdAt: new Date(),
          ...data
        };
        state.webhookEvents.push(created);
        return created;
      })
    },
    notificationAttempt: {
      count: vi.fn().mockImplementation(async ({ where }: any) => {
        return state.attempts.filter((row) => row.outboxId === where.outboxId).length;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        state.attempts.push(data);
        return data;
      })
    },
    reportRequest: {
      count: vi.fn().mockResolvedValue(0)
    }
  } as any;

  return { tx, state };
};

describe('NotificationsService', () => {
  it('is idempotent for repeated enqueueTemplate calls', async () => {
    const queueService = {
      enqueue: vi.fn().mockResolvedValue(undefined)
    };
    const service = new NotificationsService(queueService as any);
    const { tx, state } = buildTx();

    await service.enqueueTemplate(tx, {
      tenantId: 'tenant-1',
      channel: 'email',
      templateKey: 'assignment_created',
      payload: { assignment_id: 'assignment-1' },
      idempotencyKey: 'assignment_created:assignment-1'
    });

    await service.enqueueTemplate(tx, {
      tenantId: 'tenant-1',
      channel: 'email',
      templateKey: 'assignment_created',
      payload: { assignment_id: 'assignment-1' },
      idempotencyKey: 'assignment_created:assignment-1'
    });

    expect(state.outbox).toHaveLength(1);
    expect(queueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it('deduplicates webhook events by provider event id', async () => {
    const queueService = {
      enqueue: vi.fn().mockResolvedValue(undefined)
    };
    const service = new NotificationsService(queueService as any);
    const { tx, state } = buildTx();

    state.outbox.push({
      id: 'outbox-1',
      tenantId: 'tenant-1',
      providerMessageId: 'msg-1',
      status: 'queued',
      sentAt: null
    });

    const first = await service.recordWebhookEvent(tx, {
      tenantId: 'tenant-1',
      provider: 'sendgrid',
      eventType: 'delivered',
      providerEventId: 'evt-1',
      providerMessageId: 'msg-1',
      status: 'delivered',
      payloadJson: { ok: true }
    });

    const second = await service.recordWebhookEvent(tx, {
      tenantId: 'tenant-1',
      provider: 'sendgrid',
      eventType: 'delivered',
      providerEventId: 'evt-1',
      providerMessageId: 'msg-1',
      status: 'delivered',
      payloadJson: { ok: true }
    });

    expect(state.webhookEvents).toHaveLength(1);
    expect(state.attempts).toHaveLength(1);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
  });

  it('routes assignment_created to FIELD group targets', async () => {
    const queueService = {
      enqueue: vi.fn().mockResolvedValue(undefined)
    };
    const service = new NotificationsService(queueService as any);
    const { tx, state } = buildTx();

    tx.notificationTarget.findMany.mockResolvedValue([
      {
        id: 'target-1',
        tenantId: 'tenant-1',
        groupId: 'group-field',
        channel: 'whatsapp',
        toContactPointId: 'cp-2',
        isActive: true,
        toContactPoint: state.contactPoints[1]
      }
    ]);

    await service.enqueueEvent(tx, {
      tenantId: 'tenant-1',
      eventType: 'assignment_created',
      payload: { assignment_id: 'assignment-1' },
      idempotencyKey: 'assignment_created:assignment-1'
    });

    expect(state.outbox).toHaveLength(1);
    expect(state.outbox[0]?.toContactPointId).toBe('cp-2');
    expect(state.outbox[0]?.channel).toBe('whatsapp');
  });

  it('supports manual whatsapp create + mark sent flow', async () => {
    const queueService = {
      enqueue: vi.fn().mockResolvedValue(undefined)
    };
    const service = new NotificationsService(queueService as any);
    const { tx, state } = buildTx();

    const created = await service.createManualWhatsappOutbox(
      tx,
      { aud: 'studio', tenant_id: 'tenant-1', user_id: 'user-1' } as any,
      { to: '+919999000111', message: 'manual demo' }
    );

    expect(created.status).toBe('queued');
    expect(queueService.enqueue).not.toHaveBeenCalled();

    const updated = await service.markOutboxManualSent(
      tx,
      { aud: 'studio', tenant_id: 'tenant-1', user_id: 'user-1' } as any,
      created.id,
      { sent_by: 'operator' }
    );

    expect(updated.status).toBe('sent');
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]?.errorCode).toBe('manual_send');
  });
});
