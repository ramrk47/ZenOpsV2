import { BadRequestException, Body, Controller, Headers, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import Stripe from 'stripe';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { JwtClaims } from '@zenops/auth';
import { Claims } from '../auth/claims.decorator.js';
import { Public } from '../auth/public.decorator.js';
import { Capabilities } from '../auth/rbac.js';
import { RequestContextService } from '../db/request-context.service.js';
import {
  BillingControlService,
  type PaymentCheckoutLinkInput,
  type PaymentTopupInput
} from './billing-control.service.js';

const CheckoutSchema = z.object({
  account_id: z.string().uuid().optional(),
  external_key: z.string().min(1).optional(),
  amount: z.number().positive(),
  currency: z.string().min(3).max(8).optional(),
  purpose: z.enum(['topup', 'invoice']),
  provider: z.enum(['stripe', 'razorpay']),
  ref_type: z.string().min(1).optional(),
  ref_id: z.string().min(1).optional(),
  service_invoice_id: z.string().uuid().optional(),
  credits_amount: z.number().int().nonnegative().optional(),
  idempotency_key: z.string().min(1)
});

const TopupSchema = z.object({
  account_id: z.string().uuid().optional(),
  external_key: z.string().min(1).optional(),
  credits_amount: z.number().int().positive(),
  provider: z.enum(['stripe', 'razorpay']),
  idempotency_key: z.string().min(1)
});

const parseOrThrow = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.flatten());
  }
  return parsed.data;
};

const safeCompare = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
};

const bodyToRaw = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value ?? {});
};

@Controller('payments')
export class PaymentsController {
  private stripeClient: Stripe | null | undefined;

  constructor(
    private readonly requestContext: RequestContextService,
    private readonly billingControlService: BillingControlService
  ) {}

  private assertPaymentsWrite(claims: JwtClaims): void {
    if (claims.roles.includes('super_admin') || claims.capabilities.includes('*')) {
      return;
    }
    if (claims.aud === 'portal') {
      return;
    }
    if (claims.aud === 'web') {
      if (claims.capabilities.includes(Capabilities.invoicesRead) || claims.capabilities.includes(Capabilities.invoicesWrite)) {
        return;
      }
    }
    if (!claims.capabilities.includes(Capabilities.invoicesWrite) && !claims.capabilities.includes('billing:write')) {
      throw new UnauthorizedException('PAYMENTS_WRITE_FORBIDDEN');
    }
  }

  private devBypassEnabled(): boolean {
    const enabled = (process.env.PAYMENT_WEBHOOK_DEV_BYPASS ?? '').toLowerCase() === 'true';
    const env = (process.env.NODE_ENV ?? process.env.ENVIRONMENT ?? '').toLowerCase();
    if (enabled && (env === 'production' || env === 'prod')) {
      throw new UnauthorizedException('PAYMENT_WEBHOOK_DEV_BYPASS_DISABLED_IN_PROD');
    }
    return enabled;
  }

  private getStripeClient(): Stripe {
    if (this.stripeClient) {
      return this.stripeClient;
    }
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
      throw new UnauthorizedException('STRIPE_SECRET_KEY_NOT_CONFIGURED');
    }
    this.stripeClient = new Stripe(secret);
    return this.stripeClient;
  }

  @Post('checkout-link')
  async createCheckoutLink(@Claims() claims: JwtClaims, @Body() body: unknown) {
    this.assertPaymentsWrite(claims);
    const input = parseOrThrow<PaymentCheckoutLinkInput>(CheckoutSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) => this.billingControlService.createPaymentCheckoutLink(tx, input));
  }

  @Post('topup')
  async createTopup(@Claims() claims: JwtClaims, @Body() body: unknown) {
    this.assertPaymentsWrite(claims);
    const input = parseOrThrow<PaymentTopupInput>(TopupSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) => this.billingControlService.createTopupPayment(tx, input));
  }

  @Post('webhooks/stripe')
  @Public()
  async stripeWebhook(
    @Req() req: FastifyRequest,
    @Headers('stripe-signature') stripeSignature: string | undefined
  ) {
    const rawBody = (req as FastifyRequest & { rawBody?: string }).rawBody ?? bodyToRaw(req.body);
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');

    const bypass = this.devBypassEnabled();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event: Stripe.Event;
    if (bypass) {
      const parsed = JSON.parse(rawBody || '{}') as Record<string, unknown>;
      event = {
        id: typeof parsed.id === 'string' ? parsed.id : `stripe-dev-${Date.now().toString(36)}`,
        type: typeof parsed.type === 'string' ? parsed.type : 'dev.event',
        data: {
          object:
            typeof parsed.data === 'object' && parsed.data && 'object' in (parsed.data as Record<string, unknown>)
              ? ((parsed.data as Record<string, unknown>).object as Stripe.Event.Data.Object)
              : ({} as Stripe.Event.Data.Object)
        }
      } as Stripe.Event;
    } else {
      if (!webhookSecret) {
        throw new UnauthorizedException('STRIPE_WEBHOOK_SECRET_NOT_CONFIGURED');
      }
      if (!stripeSignature) {
        throw new UnauthorizedException('MISSING_STRIPE_SIGNATURE');
      }
      event = this.getStripeClient().webhooks.constructEvent(rawBody, stripeSignature, webhookSecret);
    }

    const result = await this.requestContext.runService((tx) =>
      this.billingControlService.ingestPaymentWebhook(tx, {
        provider: 'stripe',
        event_id: event.id,
        event_type: event.type,
        signature_ok: true,
        payload_json: event as unknown as Record<string, unknown>,
        payload_hash: payloadHash
      })
    );

    return {
      ok: true,
      duplicate: result.duplicate,
      event_id: result.event_id,
      processed: result.processed
    };
  }

  @Post('webhooks/razorpay')
  @Public()
  async razorpayWebhook(
    @Req() req: FastifyRequest,
    @Headers('x-razorpay-signature') signature: string | undefined
  ) {
    const rawBody = (req as FastifyRequest & { rawBody?: string }).rawBody ?? bodyToRaw(req.body);
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');

    const bypass = this.devBypassEnabled();
    if (!bypass) {
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
      if (!webhookSecret) {
        throw new UnauthorizedException('RAZORPAY_WEBHOOK_SECRET_NOT_CONFIGURED');
      }
      if (!signature || signature.length === 0) {
        throw new UnauthorizedException('MISSING_RAZORPAY_SIGNATURE');
      }
      const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
      if (!safeCompare(expected, signature)) {
        throw new UnauthorizedException('WEBHOOK_SIGNATURE_INVALID');
      }
    }

    const payload = JSON.parse(rawBody || '{}') as Record<string, unknown>;
    const eventId = typeof payload.event_id === 'string' && payload.event_id.length > 0
      ? payload.event_id
      : `razorpay-dev-${Date.now().toString(36)}`;
    const eventType = typeof payload.event === 'string' && payload.event.length > 0 ? payload.event : 'dev.event';

    const result = await this.requestContext.runService((tx) =>
      this.billingControlService.ingestPaymentWebhook(tx, {
        provider: 'razorpay',
        event_id: eventId,
        event_type: eventType,
        signature_ok: true,
        payload_json: payload,
        payload_hash: payloadHash
      })
    );

    return {
      ok: true,
      duplicate: result.duplicate,
      event_id: result.event_id,
      processed: result.processed
    };
  }
}
