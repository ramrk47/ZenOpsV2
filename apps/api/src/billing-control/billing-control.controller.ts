import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/public.decorator.js';
import { RequestContextService } from '../db/request-context.service.js';
import {
  BillingControlService,
  type BillingCreditConsumeInput,
  type BillingCreditReleaseInput,
  type BillingCreditReserveInput,
  type BillingUsageEventInput
} from './billing-control.service.js';

const BillingCreditReserveSchema = z.object({
  account_id: z.string().uuid().optional(),
  external_key: z.string().min(1).optional(),
  amount: z.number().int().positive().optional(),
  ref_type: z.string().min(1),
  ref_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  operator_override: z.boolean().optional()
});

const BillingCreditConsumeSchema = z.object({
  account_id: z.string().uuid().optional(),
  external_key: z.string().min(1).optional(),
  reservation_id: z.string().uuid().optional(),
  ref_type: z.string().min(1).optional(),
  ref_id: z.string().min(1).optional(),
  idempotency_key: z.string().min(1)
});

const BillingCreditReleaseSchema = BillingCreditConsumeSchema;

const BillingUsageEventSchema = z.object({
  source_system: z.enum(['v1', 'v2']),
  event_type: z.string().min(1),
  account_id: z.string().uuid().optional(),
  external_account_key: z.string().min(1).optional(),
  payload_json: z.record(z.any()).optional(),
  idempotency_key: z.string().min(1)
});

const parseOrThrow = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.flatten());
  }
  return parsed.data;
};

@Controller('billing')
export class BillingControlController {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly billingControlService: BillingControlService
  ) {}

  private extractServiceToken(serviceTokenHeader?: string, authHeader?: string): string | null {
    if (serviceTokenHeader && serviceTokenHeader.trim().length > 0) {
      return serviceTokenHeader.trim();
    }
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    return null;
  }

  @Get('accounts/:accountId/status')
  @Public()
  async getAccountStatus(
    @Param('accountId') accountId: string,
    @Headers('x-service-token') serviceToken: string | undefined,
    @Headers('authorization') authorization: string | undefined
  ) {
    const token = this.extractServiceToken(serviceToken, authorization);
    this.billingControlService.requireStudioServiceToken(token);
    return this.requestContext.runService((tx) => this.billingControlService.getAccountStatus(tx, accountId));
  }

  @Get('accounts/status')
  @Public()
  async getAccountStatusByExternalKey(
    @Query('external_key') externalKey: string | undefined,
    @Headers('x-service-token') serviceToken: string | undefined,
    @Headers('authorization') authorization: string | undefined
  ) {
    if (!externalKey || externalKey.trim().length === 0) {
      throw new BadRequestException('external_key is required');
    }
    const token = this.extractServiceToken(serviceToken, authorization);
    this.billingControlService.requireStudioServiceToken(token);
    return this.requestContext.runService((tx) =>
      this.billingControlService.getAccountStatusByExternalKey(tx, externalKey.trim())
    );
  }

  @Post('credits/reserve')
  @Public()
  async reserveCredits(
    @Body() body: unknown,
    @Headers('x-service-token') serviceToken: string | undefined,
    @Headers('authorization') authorization: string | undefined
  ) {
    const token = this.extractServiceToken(serviceToken, authorization);
    this.billingControlService.requireStudioServiceToken(token);
    const input = parseOrThrow<BillingCreditReserveInput>(BillingCreditReserveSchema, body);
    return this.requestContext.runService((tx) => this.billingControlService.reserveCredits(tx, input));
  }

  @Post('credits/consume')
  @Public()
  async consumeCredits(
    @Body() body: unknown,
    @Headers('x-service-token') serviceToken: string | undefined,
    @Headers('authorization') authorization: string | undefined
  ) {
    const token = this.extractServiceToken(serviceToken, authorization);
    this.billingControlService.requireStudioServiceToken(token);
    const input = parseOrThrow<BillingCreditConsumeInput>(BillingCreditConsumeSchema, body);
    return this.requestContext.runService((tx) => this.billingControlService.consumeCredits(tx, input));
  }

  @Post('credits/release')
  @Public()
  async releaseCredits(
    @Body() body: unknown,
    @Headers('x-service-token') serviceToken: string | undefined,
    @Headers('authorization') authorization: string | undefined
  ) {
    const token = this.extractServiceToken(serviceToken, authorization);
    this.billingControlService.requireStudioServiceToken(token);
    const input = parseOrThrow<BillingCreditReleaseInput>(BillingCreditReleaseSchema, body);
    return this.requestContext.runService((tx) => this.billingControlService.releaseCredits(tx, input));
  }

  @Post('events')
  @Public()
  async ingestEvent(
    @Body() body: unknown,
    @Headers('x-service-token') serviceToken: string | undefined,
    @Headers('authorization') authorization: string | undefined
  ) {
    const token = this.extractServiceToken(serviceToken, authorization);
    this.billingControlService.requireStudioServiceToken(token);
    const input = parseOrThrow<BillingUsageEventInput>(BillingUsageEventSchema, body);
    return this.requestContext.runService((tx) => this.billingControlService.ingestUsageEvent(tx, input));
  }
}
