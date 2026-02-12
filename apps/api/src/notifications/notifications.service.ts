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

export interface EnqueueEventInput {
  tenantId: string;
  eventType: 'assignment_created' | 'report_draft_ready' | 'report_finalized' | 'invoice_created' | 'invoice_paid';
  templateKey?: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  assignmentId?: string;
  reportRequestId?: string;
  invoiceId?: string;
  documentId?: string;
  requestId?: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly queueService: NotificationQueueService) {}

  async enqueueEvent(tx: TxClient, input: EnqueueEventInput) {
    const groupKey = this.routeGroupForEvent(input.eventType);
    const preferredChannels = this.channelsForEvent(input.eventType);

    const groupTargets = await tx.notificationTarget.findMany({
      where: {
        tenantId: input.tenantId,
        isActive: true,
        channel: {
          in: preferredChannels
        },
        group: {
          groupKey,
          isActive: true
        }
      },
      include: {
        toContactPoint: true
      }
    });

    const subscriptions = await tx.notificationSubscription.findMany({
      where: {
        tenantId: input.tenantId,
        eventType: input.eventType,
        isActive: true
      },
      include: {
        employee: true
      }
    });

    const routed = new Map<string, { channel: 'email' | 'whatsapp'; contactPointId: string }>();
    for (const target of groupTargets) {
      routed.set(`${target.channel}:${target.toContactPointId}`, {
        channel: target.channel,
        contactPointId: target.toContactPointId
      });
    }

    for (const subscription of subscriptions) {
      const value =
        subscription.channel === 'email'
          ? subscription.employee.email
          : subscription.channel === 'whatsapp'
            ? subscription.employee.phone
            : null;
      if (!value) {
        continue;
      }

      const contactPoint = await this.resolveContactPoint(tx, input.tenantId, subscription.channel, value);
      if (!contactPoint) {
        continue;
      }

      routed.set(`${subscription.channel}:${contactPoint.id}`, {
        channel: subscription.channel,
        contactPointId: contactPoint.id
      });
    }

    if (routed.size === 0) {
      const fallback = await this.enqueueTemplate(tx, {
        tenantId: input.tenantId,
        channel: 'email',
        templateKey: input.templateKey ?? input.eventType,
        payload: input.payload,
        idempotencyKey: `${input.idempotencyKey}:fallback`,
        assignmentId: input.assignmentId,
        reportRequestId: input.reportRequestId,
        invoiceId: input.invoiceId,
        documentId: input.documentId,
        requestId: input.requestId
      });
      return [fallback];
    }

    const routes = Array.from(routed.values()).sort((a, b) => {
      if (a.channel === b.channel) {
        return a.contactPointId.localeCompare(b.contactPointId);
      }
      return a.channel.localeCompare(b.channel);
    });

    const outbox = [];
    for (const route of routes) {
      const row = await this.enqueueTemplate(tx, {
        tenantId: input.tenantId,
        channel: route.channel,
        templateKey: input.templateKey ?? input.eventType,
        payload: input.payload,
        idempotencyKey: `${input.idempotencyKey}:${route.channel}:${route.contactPointId}`,
        toContactPointId: route.contactPointId,
        assignmentId: input.assignmentId,
        reportRequestId: input.reportRequestId,
        invoiceId: input.invoiceId,
        documentId: input.documentId,
        requestId: input.requestId
      });
      outbox.push(row);
    }

    return outbox;
  }

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

    if (event) {
      return { event, outbox: null, duplicate: true };
    }

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

        if (event) {
          return { event, outbox: null, duplicate: true };
        }
      }
    }

    if (!input.providerMessageId) {
      return { event, outbox: null, duplicate: false };
    }

    const outbox = await tx.notificationOutbox.findFirst({
      where: {
        tenantId: input.tenantId,
        providerMessageId: input.providerMessageId
      }
    });

    if (!outbox) {
      return { event, outbox: null, duplicate: false };
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
        duplicate: false,
        outbox: await tx.notificationOutbox.update({
          where: { id: outbox.id },
          data: { status: 'failed' }
        })
      };
    }

    if (input.status === 'read' || input.status === 'delivered' || input.status === 'sent') {
      return {
        event,
        duplicate: false,
        outbox: await tx.notificationOutbox.update({
          where: { id: outbox.id },
          data: {
            status: 'sent',
            sentAt: outbox.sentAt ?? new Date()
          }
        })
      };
    }

    return { event, outbox, duplicate: false };
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

  private routeGroupForEvent(
    eventType: 'assignment_created' | 'report_draft_ready' | 'report_finalized' | 'invoice_created' | 'invoice_paid'
  ): string {
    if (eventType === 'assignment_created') {
      return 'FIELD';
    }
    if (eventType === 'invoice_created' || eventType === 'invoice_paid') {
      return 'FINANCE';
    }
    return 'HR';
  }

  private channelsForEvent(
    eventType: 'assignment_created' | 'report_draft_ready' | 'report_finalized' | 'invoice_created' | 'invoice_paid'
  ): Array<'email' | 'whatsapp'> {
    if (eventType === 'assignment_created') {
      return ['whatsapp', 'email'];
    }
    return ['email'];
  }
}
