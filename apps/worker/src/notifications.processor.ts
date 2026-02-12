import type { Logger } from '@zenops/common';
import { withTxContext, type PrismaClient } from '@zenops/db';

export const NOTIFICATIONS_QUEUE = 'notifications';
const MAX_NOTIFICATION_ATTEMPTS = 5;

export interface NotificationQueuePayload {
  outboxId: string;
  tenantId: string;
  requestId: string;
}

interface AdapterInput {
  outboxId: string;
  channel: 'email' | 'whatsapp';
  to: string;
  payload: Record<string, unknown>;
  templateKey: string;
}

interface AdapterResult {
  providerMessageId?: string | null;
}

interface NotificationAdapter {
  send(input: AdapterInput): Promise<AdapterResult>;
}

class NoopAdapter implements NotificationAdapter {
  async send(input: AdapterInput): Promise<AdapterResult> {
    return { providerMessageId: `noop:${input.outboxId}` };
  }
}

class SendgridAdapter implements NotificationAdapter {
  async send(input: AdapterInput): Promise<AdapterResult> {
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      throw new Error('SENDGRID_API_KEY is not configured');
    }

    return { providerMessageId: `sendgrid:${input.outboxId}` };
  }
}

class MailgunAdapter implements NotificationAdapter {
  async send(input: AdapterInput): Promise<AdapterResult> {
    const apiKey = process.env.MAILGUN_API_KEY;
    if (!apiKey) {
      throw new Error('MAILGUN_API_KEY is not configured');
    }

    return { providerMessageId: `mailgun:${input.outboxId}` };
  }
}

class TwilioAdapter implements NotificationAdapter {
  async send(input: AdapterInput): Promise<AdapterResult> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      throw new Error('TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN are not configured');
    }

    return { providerMessageId: `twilio:${input.outboxId}` };
  }
}

const resolveAdapter = (provider: 'noop' | 'sendgrid' | 'mailgun' | 'twilio'): NotificationAdapter => {
  switch (provider) {
    case 'sendgrid':
      return new SendgridAdapter();
    case 'mailgun':
      return new MailgunAdapter();
    case 'twilio':
      return new TwilioAdapter();
    default:
      return new NoopAdapter();
  }
};

const parsePayload = (payload: unknown): Record<string, unknown> => {
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return {};
};

export interface ProcessNotificationJobParams {
  prisma: PrismaClient;
  logger: Logger;
  payload: NotificationQueuePayload;
  fallbackTenantId: string;
  runWithContext?: <T>(
    prisma: PrismaClient,
    context: { tenantId: string; userId: string | null; aud: 'worker' },
    fn: (tx: any) => Promise<T>
  ) => Promise<T>;
}

export const processNotificationJob = async ({
  prisma,
  logger,
  payload,
  fallbackTenantId,
  runWithContext = withTxContext
}: ProcessNotificationJobParams): Promise<void> => {
  const tenantId = payload.tenantId || fallbackTenantId;

  await runWithContext(prisma, { tenantId, userId: null, aud: 'worker' }, async (tx) => {
    const outbox = await tx.notificationOutbox.findFirst({
      where: {
        id: payload.outboxId,
        tenantId
      },
      include: {
        toContactPoint: {
          select: {
            kind: true,
            value: true
          }
        }
      }
    });

    if (!outbox) {
      logger.info('notification_outbox_missing', {
        request_id: payload.requestId,
        outbox_id: payload.outboxId,
        tenant_id: tenantId
      });
      return;
    }

    if (outbox.status === 'sent' || outbox.status === 'dead') {
      return;
    }

    const attemptNo =
      (await tx.notificationAttempt.count({
        where: {
          outboxId: outbox.id
        }
      })) + 1;

    await tx.notificationOutbox.update({
      where: { id: outbox.id },
      data: { status: 'sending' }
    });

    const adapter = resolveAdapter(outbox.provider);

    try {
      const sendResult = await adapter.send({
        outboxId: outbox.id,
        channel: outbox.channel,
        to: outbox.toContactPoint.value,
        payload: parsePayload(outbox.payloadJson),
        templateKey: outbox.templateKey
      });

      await tx.notificationAttempt.create({
        data: {
          tenantId,
          outboxId: outbox.id,
          attemptNo,
          provider: outbox.provider,
          providerMessageId: sendResult.providerMessageId ?? null,
          status: 'sent'
        }
      });

      await tx.notificationOutbox.update({
        where: { id: outbox.id },
        data: {
          status: 'sent',
          providerMessageId: sendResult.providerMessageId ?? outbox.providerMessageId,
          sentAt: outbox.sentAt ?? new Date()
        }
      });
    } catch (error) {
      await tx.notificationAttempt.create({
        data: {
          tenantId,
          outboxId: outbox.id,
          attemptNo,
          provider: outbox.provider,
          providerMessageId: null,
          status: 'failed',
          errorCode: 'send_failed',
          errorJson: {
            message: error instanceof Error ? error.message : 'unknown'
          }
        }
      });

      const nextStatus = attemptNo >= MAX_NOTIFICATION_ATTEMPTS ? 'dead' : 'failed';

      await tx.notificationOutbox.update({
        where: { id: outbox.id },
        data: {
          status: nextStatus
        }
      });

      if (nextStatus === 'dead') {
        logger.error('notification_dead_letter', {
          request_id: payload.requestId,
          outbox_id: outbox.id,
          tenant_id: tenantId,
          error: error instanceof Error ? error.message : 'unknown'
        });
        return;
      }

      throw error;
    }
  });
};
