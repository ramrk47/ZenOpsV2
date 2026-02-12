import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Public, RequireAudience } from '../auth/public.decorator.js';
import { Claims } from '../auth/claims.decorator.js';
import type { JwtClaims } from '@zenops/auth';
import { RequestContextService } from '../db/request-context.service.js';
import { NotificationsService } from './notifications.service.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const NotifyTestBodySchema = z.object({
  channel: z.enum(['email', 'whatsapp']).default('email'),
  to: z.string().min(3).optional()
});

const OutboxQuerySchema = z.object({
  status: z.enum(['queued', 'sending', 'sent', 'failed', 'dead']).optional(),
  limit: z.coerce.number().int().positive().max(200).optional()
});

const WebhookSchema = z
  .object({
    tenant_id: z.string().uuid(),
    provider_event_id: z.string().min(1).optional(),
    provider_message_id: z.string().min(1).optional(),
    event_type: z.string().min(1).optional(),
    status: z.enum(['sending', 'sent', 'failed', 'delivered', 'read']).optional()
  })
  .passthrough();

const parseOrThrow = <T>(parser: { safeParse: (input: unknown) => any }, body: unknown): T => {
  const parsed = parser.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error);
  }
  return parsed.data as T;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

@Controller()
export class NotificationsController {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly notificationsService: NotificationsService
  ) {}

  @Post('notify/test')
  @RequireAudience('studio')
  async notifyTest(@Claims() claims: JwtClaims, @Body() body: unknown) {
    const input = parseOrThrow<{ channel: 'email' | 'whatsapp'; to?: string }>(NotifyTestBodySchema, body);
    return this.requestContext.runWithClaims(claims, (tx) => this.notificationsService.enqueueTest(tx, claims, input));
  }

  @Get('notifications/outbox')
  @RequireAudience('studio')
  async listOutbox(@Claims() claims: JwtClaims, @Query() query: Record<string, string | undefined>) {
    const input = parseOrThrow<{ status?: 'queued' | 'sending' | 'sent' | 'failed' | 'dead'; limit?: number }>(
      OutboxQuerySchema,
      query
    );
    return this.requestContext.runWithClaims(claims, (tx) => this.notificationsService.listOutbox(tx, input));
  }

  @Post('webhooks/sendgrid')
  @Public()
  async sendgridWebhook(@Body() body: unknown) {
    return this.handleWebhook('sendgrid', body);
  }

  @Post('webhooks/twilio/whatsapp')
  @Public()
  async twilioWhatsappWebhook(@Body() body: unknown) {
    return this.handleWebhook('twilio', body);
  }

  private async handleWebhook(provider: 'sendgrid' | 'twilio', body: unknown) {
    const normalizedBody = Array.isArray(body) ? body[0] ?? {} : body;
    const parsed = parseOrThrow(WebhookSchema, normalizedBody);
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
        payloadJson: payload
      })
    );

    return {
      ok: true,
      event_id: result.event?.id ?? null,
      outbox_id: result.outbox?.id ?? null
    };
  }
}
