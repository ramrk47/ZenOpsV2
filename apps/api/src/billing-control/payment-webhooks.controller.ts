import { Controller, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '../auth/public.decorator.js';
import { RequestContextService } from '../db/request-context.service.js';
import { BillingControlService } from './billing-control.service.js';
import { paymentProviders } from './payment-providers.js';

const bodyToRaw = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value ?? {});
};

@Controller('webhooks')
export class PaymentWebhooksController {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly billingControlService: BillingControlService
  ) {}

  @Post('stripe')
  @Public()
  async stripeWebhook(@Req() req: FastifyRequest) {
    return this.handleWebhook('stripe', req);
  }

  @Post('razorpay')
  @Public()
  async razorpayWebhook(@Req() req: FastifyRequest) {
    return this.handleWebhook('razorpay', req);
  }

  private async handleWebhook(providerName: 'stripe' | 'razorpay', req: FastifyRequest) {
    const provider = paymentProviders[providerName];
    const rawBody = bodyToRaw(req.body);
    const headers = req.headers as Record<string, string | string[] | undefined>;

    if (!provider.verifyWebhookSignature(headers, rawBody)) {
      throw new UnauthorizedException('WEBHOOK_SIGNATURE_INVALID');
    }

    const parsed = provider.parseWebhookEvent(rawBody);
    const result = await this.requestContext.runService((tx) =>
      this.billingControlService.ingestSubscriptionWebhook(tx, {
        provider: providerName,
        event_id: parsed.event_id,
        event_type: parsed.event_type,
        external_subscription_id: parsed.external_subscription_id,
        payload_json: parsed.payload_json
      })
    );

    return {
      ok: true,
      duplicate: result.duplicate,
      event_id: result.event_id
    };
  }
}

