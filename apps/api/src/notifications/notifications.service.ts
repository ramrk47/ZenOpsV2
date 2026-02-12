import { Injectable } from '@nestjs/common';
import { Prisma, type TxClient } from '@zenops/db';
import type { JwtClaims } from '@zenops/auth';
import { NotificationQueueService } from './notification-queue.service.js';

export interface EnqueueTemplateInput {
  tenantId: string;
  channel: 'email' | 'whatsapp';
  templateKey: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  toValue?: string;
  toContactPointId?: string;
  assignmentId?: string;
  reportRequestId?: string;
  invoiceId?: string;
  documentId?: string;
  requestId?: string;
}

export interface WebhookEventInput {
  tenantId: string;
  provider: 'sendgrid' | 'mailgun' | 'twilio' | 'noop';
  eventType: string;
  providerEventId: string;
  providerMessageId?: string | null;
  status?: 'sending' | 'sent' | 'failed' | 'delivered' | 'read' | null;
  payloadJson: Prisma.JsonObject;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly queueService: NotificationQueueService) {}

  async enqueueTemplate(tx: TxClient, input: EnqueueTemplateInput) {
    const contactPoint = input.toContactPointId
      ? await tx.contactPoint.findFirst({
          where: {
            id: input.toContactPointId,
            tenantId: input.tenantId
          }
        })
      : await this.resolveContactPoint(tx, input.tenantId, input.channel, input.toValue);

    if (!contactPoint) {
      throw new Error(`No contact point available for tenant ${input.tenantId} and channel ${input.channel}`);
    }

    const existing = await tx.notificationOutbox.findFirst({
      where: {
        tenantId: input.tenantId,
        idempotencyKey: input.idempotencyKey
      }
    });

    if (existing) {
      return existing;
    }

    const template = await tx.notificationTemplate.findFirst({
      where: {
        tenantId: input.tenantId,
        channel: input.channel,
        templateKey: input.templateKey,
        isActive: true
      }
    });

    try {
      const outbox = await tx.notificationOutbox.create({
        data: {
          tenantId: input.tenantId,
          toContactPointId: contactPoint.id,
          channel: input.channel,
          provider: template?.provider ?? 'noop',
          templateKey: input.templateKey,
          payloadJson: input.payload as unknown as Prisma.InputJsonObject,
          status: 'queued',
          idempotencyKey: input.idempotencyKey,
          assignmentId: input.assignmentId,
          reportRequestId: input.reportRequestId,
          invoiceId: input.invoiceId,
          documentId: input.documentId
        }
      });

      await this.queueService.enqueue({
        outboxId: outbox.id,
        tenantId: outbox.tenantId,
        requestId: input.requestId ?? `outbox:${outbox.id}`
      });

      return outbox;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const retryExisting = await tx.notificationOutbox.findFirst({
          where: {
            tenantId: input.tenantId,
            idempotencyKey: input.idempotencyKey
          }
        });
        if (retryExisting) {
          return retryExisting;
        }
      }
      throw error;
    }
  }

  async enqueueTest(tx: TxClient, claims: JwtClaims, input: { channel: 'email' | 'whatsapp'; to?: string }) {
    if (!claims.tenant_id) {
      throw new Error('tenant_id missing in claims');
    }

    return this.enqueueTemplate(tx, {
      tenantId: claims.tenant_id,
      channel: input.channel,
      templateKey: 'test_notification',
      payload: {
        ts: new Date().toISOString(),
        source: 'notify_test'
      },
      idempotencyKey: `notify-test:${claims.tenant_id}:${input.channel}:${input.to ?? 'default'}`,
      toValue: input.to
    });
  }

  async listOutbox(
    tx: TxClient,
    input: { status?: 'queued' | 'sending' | 'sent' | 'failed' | 'dead'; limit?: number }
  ) {
    const rows = await tx.notificationOutbox.findMany({
      where: input.status ? { status: input.status } : undefined,
      include: {
        toContactPoint: true,
        attempts: {
          orderBy: { attemptNo: 'desc' },
          take: 1
        }
      },
      orderBy: [{ createdAt: 'desc' }],
      take: input.limit ?? 50
    });

    return rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenantId,
      channel: row.channel,
      provider: row.provider,
      template_key: row.templateKey,
      status: row.status,
      idempotency_key: row.idempotencyKey,
      to: {
        kind: row.toContactPoint.kind,
        value: row.toContactPoint.value
      },
      provider_message_id: row.providerMessageId,
      queued_at: row.queuedAt.toISOString(),
      sent_at: row.sentAt?.toISOString() ?? null,
      latest_attempt: row.attempts[0]
        ? {
            attempt_no: row.attempts[0].attemptNo,
            status: row.attempts[0].status,
            error_code: row.attempts[0].errorCode
          }
        : null
    }));
  }

  async recordWebhookEvent(tx: TxClient, input: WebhookEventInput) {
    let event = await tx.webhookEvent.findFirst({
      where: {
        provider: input.provider,
        providerEventId: input.providerEventId
      }
    });

    if (!event) {
      try {
        event = await tx.webhookEvent.create({
          data: {
            tenantId: input.tenantId,
            provider: input.provider,
            eventType: input.eventType,
            providerEventId: input.providerEventId,
            payloadJson: input.payloadJson as unknown as Prisma.InputJsonObject
          }
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
          throw error;
        }

        event = await tx.webhookEvent.findFirst({
          where: {
            provider: input.provider,
            providerEventId: input.providerEventId
          }
        });
      }
    }

    if (!input.providerMessageId) {
      return { event, outbox: null };
    }

    const outbox = await tx.notificationOutbox.findFirst({
      where: {
        tenantId: input.tenantId,
        providerMessageId: input.providerMessageId
      }
    });

    if (!outbox) {
      return { event, outbox: null };
    }

    const nextAttemptNo =
      (await tx.notificationAttempt.count({
        where: {
          outboxId: outbox.id
        }
      })) + 1;

    await tx.notificationAttempt.create({
      data: {
        tenantId: input.tenantId,
        outboxId: outbox.id,
        attemptNo: nextAttemptNo,
        provider: input.provider,
        providerMessageId: input.providerMessageId,
        status: input.status ?? 'delivered',
        errorCode: null,
        errorJson: undefined
      }
    });

    if (input.status === 'failed') {
      return {
        event,
        outbox: await tx.notificationOutbox.update({
          where: { id: outbox.id },
          data: { status: 'failed' }
        })
      };
    }

    if (input.status === 'read' || input.status === 'delivered' || input.status === 'sent') {
      return {
        event,
        outbox: await tx.notificationOutbox.update({
          where: { id: outbox.id },
          data: {
            status: 'sent',
            sentAt: outbox.sentAt ?? new Date()
          }
        })
      };
    }

    return { event, outbox };
  }

  private async resolveContactPoint(tx: TxClient, tenantId: string, channel: 'email' | 'whatsapp', value?: string) {
    const contactKind = channel === 'email' ? 'email' : 'whatsapp';
    const fallbackValue = channel === 'email' ? process.env.NOTIFY_INTERNAL_EMAIL ?? 'internal-admin@zenops.local' : null;
    const normalizedValue = value ?? fallbackValue;

    if (!normalizedValue) {
      return null;
    }

    const existing = await tx.contactPoint.findFirst({
      where: {
        tenantId,
        kind: contactKind,
        value: normalizedValue
      }
    });

    if (existing) {
      return existing;
    }

    return tx.contactPoint.create({
      data: {
        tenantId,
        kind: contactKind,
        value: normalizedValue,
        isPrimary: true,
        isVerified: false
      }
    });
  }
}
