import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Claims } from '../auth/claims.decorator.js';
import type { JwtClaims } from '@zenops/auth';
import { RequireAudience, RequireCapabilities } from '../auth/public.decorator.js';
import { Capabilities } from '../auth/rbac.js';
import { RequestContextService } from '../db/request-context.service.js';
import {
  BillingControlService,
  type BillingAccountCreateInput,
  type BillingCreditConsumeInput,
  type BillingCreditGrantInput,
  type BillingCreditReleaseInput,
  type BillingCreditReserveInput,
  type BillingPolicyUpdateInput
} from '../billing-control/billing-control.service.js';

const AccountCreateSchema = z.object({
  tenant_id: z.string().uuid(),
  account_type: z.enum(['tenant', 'external_associate']),
  display_name: z.string().min(1),
  external_key: z.string().min(1),
  payment_terms_days: z.number().int().positive().optional()
});

const BillingPolicySchema = z.object({
  billing_mode: z.enum(['postpaid', 'credit']),
  payment_terms_days: z.number().int().positive().optional(),
  currency: z.string().min(1).optional(),
  is_enabled: z.boolean().optional()
});

const AccountStatusSchema = z.object({
  status: z.enum(['active', 'suspended'])
});

const CreditGrantSchema = z.object({
  amount: z.number().int().positive(),
  reason: z.enum(['grant', 'topup', 'adjustment']).optional(),
  ref_type: z.string().optional(),
  ref_id: z.string().optional(),
  idempotency_key: z.string().min(1),
  metadata_json: z.record(z.any()).optional()
});

const CreditReserveSchema = z.object({
  account_id: z.string().uuid().optional(),
  external_key: z.string().min(1).optional(),
  amount: z.number().int().positive().optional(),
  ref_type: z.string().min(1),
  ref_id: z.string().min(1),
  idempotency_key: z.string().min(1)
});

const CreditSettleSchema = z.object({
  account_id: z.string().uuid().optional(),
  external_key: z.string().min(1).optional(),
  reservation_id: z.string().uuid().optional(),
  ref_type: z.string().min(1).optional(),
  ref_id: z.string().min(1).optional(),
  idempotency_key: z.string().min(1)
});

const SubscriptionAssignSchema = z.object({
  account_id: z.string().uuid(),
  plan_name: z.string().min(1),
  monthly_credit_allowance: z.number().int().positive().optional(),
  status: z.enum(['active', 'past_due', 'cancelled']).optional()
});

const parseOrThrow = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.flatten());
  }
  return parsed.data;
};

@Controller('control')
export class ControlController {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly billingControlService: BillingControlService
  ) {}

  @Get('tenant')
  @RequireAudience('studio')
  @RequireCapabilities(Capabilities.masterDataRead)
  listTenants(@Claims() claims: JwtClaims, @Query('search') search?: string) {
    return this.requestContext.runWithClaims(claims, (tx) => this.billingControlService.listAccounts(tx, search));
  }

  @Post('accounts')
  @RequireAudience('studio')
  @RequireCapabilities(Capabilities.masterDataWrite)
  createAccount(@Claims() claims: JwtClaims, @Body() body: unknown) {
    const input = parseOrThrow<BillingAccountCreateInput>(AccountCreateSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) => this.billingControlService.createAccount(tx, input));
  }

  @Get('accounts/:id/status')
  @RequireAudience('studio')
  @RequireCapabilities(Capabilities.masterDataRead)
  getAccountStatus(@Claims() claims: JwtClaims, @Param('id') id: string) {
    return this.requestContext.runWithClaims(claims, (tx) => this.billingControlService.getAccountStatus(tx, id));
  }

  @Patch('accounts/:id/policy')
  @RequireAudience('studio')
  @RequireCapabilities(Capabilities.invoicesWrite)
  setPolicy(@Claims() claims: JwtClaims, @Param('id') id: string, @Body() body: unknown) {
    const input = parseOrThrow<BillingPolicyUpdateInput>(BillingPolicySchema, body);
    return this.requestContext.runWithClaims(claims, (tx) => this.billingControlService.setBillingPolicy(tx, id, input));
  }

  @Patch('accounts/:id/status')
  @RequireAudience('studio')
  @RequireCapabilities(Capabilities.masterDataWrite)
  setAccountStatus(@Claims() claims: JwtClaims, @Param('id') id: string, @Body() body: unknown) {
    const input = parseOrThrow<{ status: 'active' | 'suspended' }>(AccountStatusSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) => this.billingControlService.setAccountStatus(tx, id, input.status));
  }

  @Post('accounts/:id/credits/grant')
  @RequireAudience('studio')
  @RequireCapabilities(Capabilities.invoicesWrite)
  grantCredits(@Claims() claims: JwtClaims, @Param('id') id: string, @Body() body: unknown) {
    const input = parseOrThrow<BillingCreditGrantInput>(CreditGrantSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) => this.billingControlService.grantCredits(tx, id, input));
  }

  @Get('subscriptions')
  @RequireAudience('studio')
  @RequireCapabilities(Capabilities.masterDataRead)
  listSubscriptions(@Claims() claims: JwtClaims) {
    return this.requestContext.runWithClaims(claims, (tx) => this.billingControlService.listSubscriptions(tx));
  }

  @Post('subscriptions/assign')
  @RequireAudience('studio')
  @RequireCapabilities(Capabilities.masterDataWrite)
  assignSubscription(@Claims() claims: JwtClaims, @Body() body: unknown) {
    const input = parseOrThrow<{
      account_id: string;
      plan_name: string;
      monthly_credit_allowance?: number;
      status?: 'active' | 'past_due' | 'cancelled';
    }>(SubscriptionAssignSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) => this.billingControlService.assignSubscription(tx, input));
  }

  @Get('credits')
  @RequireAudience('studio')
  @RequireCapabilities(Capabilities.masterDataRead)
  listCredits(@Claims() claims: JwtClaims, @Query('account_id') accountId?: string) {
    return this.requestContext.runWithClaims(claims, (tx) => this.billingControlService.listCreditLedger(tx, accountId));
  }

  @Get('credits/tenant/:tenantId')
  @RequireAudience('studio')
  @RequireCapabilities(Capabilities.masterDataRead)
  getTenantCredits(@Claims() claims: JwtClaims, @Param('tenantId') tenantId: string) {
    return this.requestContext.runWithClaims(claims, (tx) => this.billingControlService.getTenantCreditStatus(tx, tenantId));
  }

  @Get('credits/reservations')
  @RequireAudience('studio')
  @RequireCapabilities(Capabilities.masterDataRead)
  listCreditReservations(
    @Claims() claims: JwtClaims,
    @Query('account_id') accountId?: string,
    @Query('tenant_id') tenantId?: string,
    @Query('status') status?: 'active' | 'consumed' | 'released',
    @Query('limit') limit?: string
  ) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.billingControlService.listCreditReservations(tx, {
        account_id: accountId,
        tenant_id: tenantId,
        status,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined
      })
    );
  }

  @Get('credits/timeline')
  @RequireAudience('studio')
  @RequireCapabilities(Capabilities.masterDataRead)
  listCreditTimeline(
    @Claims() claims: JwtClaims,
    @Query('account_id') accountId?: string,
    @Query('tenant_id') tenantId?: string,
    @Query('limit') limit?: string
  ) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.billingControlService.listBillingTimeline(tx, {
        account_id: accountId,
        tenant_id: tenantId,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined
      })
    );
  }

  @Post('credits/reserve')
  @RequireAudience('studio')
  @RequireCapabilities(Capabilities.invoicesWrite)
  reserveCredits(@Claims() claims: JwtClaims, @Body() body: unknown) {
    const input = parseOrThrow<BillingCreditReserveInput>(CreditReserveSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) => this.billingControlService.reserveCredits(tx, input));
  }

  @Post('credits/consume')
  @RequireAudience('studio')
  @RequireCapabilities(Capabilities.invoicesWrite)
  consumeCredits(@Claims() claims: JwtClaims, @Body() body: unknown) {
    const input = parseOrThrow<BillingCreditConsumeInput>(CreditSettleSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) => this.billingControlService.consumeCredits(tx, input));
  }

  @Post('credits/release')
  @RequireAudience('studio')
  @RequireCapabilities(Capabilities.invoicesWrite)
  releaseCredits(@Claims() claims: JwtClaims, @Body() body: unknown) {
    const input = parseOrThrow<BillingCreditReleaseInput>(CreditSettleSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) => this.billingControlService.releaseCredits(tx, input));
  }
}
