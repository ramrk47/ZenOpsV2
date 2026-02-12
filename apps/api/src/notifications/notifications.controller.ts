import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Public, RequireAudience } from '../auth/public.decorator.js';
import { Claims } from '../auth/claims.decorator.js';
import type { JwtClaims } from '@zenops/auth';
import { Prisma } from '@zenops/db';
import { RequestContextService } from '../db/request-context.service.js';
import { NotificationsService } from './notifications.service.js';
import { randomUUID } from 'node:crypto';

type OutboxStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'dead';
type AttemptStatus = 'sending' | 'sent' | 'failed' | 'delivered' | 'read';

const asRecord = (value: unknown): Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
};

const parseNotifyTestBody = (body: unknown): { channel: 'email' | 'whatsapp'; to?: string } => {
  const data = asRecord(body);
  const channel = data.channel;
  const to = data.to;

  const normalizedChannel = channel === undefined ? 'email' : channel;
  if (normalizedChannel !== 'email' && normalizedChannel !== 'whatsapp') {
    throw new BadRequestException('channel must be email or whatsapp');
  }

  if (to !== undefined && (typeof to !== 'string' || to.trim().length < 3)) {
    throw new BadRequestException('to must be a string with length >= 3');
  }

  return {
    channel: normalizedChannel,
    ...(typeof to === 'string' ? { to } : {})
  };
};

const parseOutboxQuery = (query: Record<string, string | undefined>): { status?: OutboxStatus; limit?: number } => {
  const status = query.status;
  const limitValue = query.limit;

  if (
    status !== undefined &&
    status !== 'queued' &&
    status !== 'sending' &&
    status !== 'sent' &&
    status !== 'failed' &&
    status !== 'dead'
  ) {
    throw new BadRequestException('invalid status');
  }

  if (limitValue === undefined) {
    return { ...(status ? { status } : {}) };
  }

  const limit = Number(limitValue);
  if (!Number.isInteger(limit) || limit <= 0 || limit > 200) {
    throw new BadRequestException('limit must be an integer between 1 and 200');
  }

  return {
    ...(status ? { status } : {}),
    limit
  };
};

const parseWebhookBody = (body: unknown): {
  tenant_id: string;
  provider_event_id?: string;
  provider_message_id?: string;
  event_type?: string;
  status?: AttemptStatus;
} => {
  const data = asRecord(body);
  const tenantId = data.tenant_id;
  if (typeof tenantId !== 'string' || tenantId.trim().length < 1) {
    throw new BadRequestException('tenant_id is required');
  }

  const status = data.status;
  if (
    status !== undefined &&
    status !== 'sending' &&
    status !== 'sent' &&
    status !== 'failed' &&
    status !== 'delivered' &&
    status !== 'read'
  ) {
    throw new BadRequestException('invalid status');
  }

  const asOptionalString = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined);

  return {
    tenant_id: tenantId,
    provider_event_id: asOptionalString(data.provider_event_id),
    provider_message_id: asOptionalString(data.provider_message_id),
    event_type: asOptionalString(data.event_type),
    ...(status ? { status } : {})
  };
};

@Controller()
export class NotificationsController {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly notificationsService: NotificationsService
  ) {}

  @Post('notify/test')
  @RequireAudience('studio')
  async notifyTest(@Claims() claims: JwtClaims, @Body() body: unknown) {
    const input = parseNotifyTestBody(body);
    return this.requestContext.runWithClaims(claims, (tx) => this.notificationsService.enqueueTest(tx, claims, input));
  }

  @Get('notifications/outbox')
  @RequireAudience('studio')
  async listOutbox(@Claims() claims: JwtClaims, @Query() query: Record<string, string | undefined>) {
    const input = parseOutboxQuery(query);
    return this.requestContext.runWithClaims(claims, (tx) => this.notificationsService.listOutbox(tx, input));
  }

  @Post('webhooks/sendgrid')
  @Public()
  async sendgridWebhook(@Body() body: unknown) {
    return this.handleWebhook('sendgrid', body);
  }

  @Post('webhooks/email')
  @Public()
  async emailWebhook(@Body() body: unknown) {
    return this.handleWebhook('sendgrid', body);
  }

  @Post('webhooks/twilio/whatsapp')
  @Public()
  async twilioWhatsappWebhook(@Body() body: unknown) {
    return this.handleWebhook('twilio', body);
  }

  @Post('webhooks/twilio')
  @Public()
  async twilioWebhook(@Body() body: unknown) {
    return this.handleWebhook('twilio', body);
  }

  private async handleWebhook(provider: 'sendgrid' | 'twilio', body: unknown) {
    const normalizedBody = Array.isArray(body) ? body[0] ?? {} : body;
    const parsed = parseWebhookBody(normalizedBody);
    const payload = asRecord(normalizedBody);

    const providerEventId =
      parsed.provider_event_id ??
      (typeof payload.sg_event_id === 'string' ? payload.sg_event_id : undefined) ??
      (typeof payload.event_id === 'string' ? payload.event_id : undefined) ??
      (typeof payload.MessageSid === 'string' ? payload.MessageSid : undefined) ??
      randomUUID();

    const providerMessageId =
      parsed.provider_message_id ??
      (typeof payload.sg_message_id === 'string' ? payload.sg_message_id : undefined) ??
      (typeof payload.message_id === 'string' ? payload.message_id : undefined) ??
      (typeof payload.MessageSid === 'string' ? payload.MessageSid : undefined) ??
      null;

    const eventType =
      parsed.event_type ??
      (typeof payload.event === 'string' ? payload.event : undefined) ??
      (typeof payload.SmsStatus === 'string' ? payload.SmsStatus : undefined) ??
      'webhook';

    const status = parsed.status;

    const result = await this.requestContext.runWorker(parsed.tenant_id, (tx) =>
      this.notificationsService.recordWebhookEvent(tx, {
        tenantId: parsed.tenant_id,
        provider,
        providerEventId,
        providerMessageId,
        eventType,
        status,
        payloadJson: payload as unknown as Prisma.JsonObject
      })
    );

    return {
      ok: true,
      event_id: result.event?.id ?? null,
      outbox_id: result.outbox?.id ?? null
    };
  }
}
