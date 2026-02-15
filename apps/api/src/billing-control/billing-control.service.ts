import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from '@nestjs/common';
import { Prisma, type TxClient } from '@zenops/db';

type AccountType = 'tenant' | 'external_associate';
type AccountStatus = 'active' | 'suspended';
type BillingMode = 'postpaid' | 'credit';
type CreditReason = 'grant' | 'topup' | 'reserve' | 'consume' | 'release' | 'adjustment';
type ReservationStatus = 'active' | 'consumed' | 'released';
type ServiceInvoiceStatus = 'draft' | 'issued' | 'sent' | 'partially_paid' | 'paid' | 'void';
type BillingSubscriptionStatusValue = 'active' | 'paused' | 'past_due' | 'cancelled';

export interface BillingAccountCreateInput {
  tenant_id: string;
  account_type: AccountType;
  display_name: string;
  external_key: string;
  payment_terms_days?: number;
}

export interface BillingPolicyUpdateInput {
  billing_mode?: BillingMode;
  payment_terms_days?: number;
  currency?: string;
  is_enabled?: boolean;
  force_enable_credit?: boolean;
}

export interface BillingCreditGrantInput {
  amount: number;
  reason?: 'grant' | 'topup' | 'adjustment';
  ref_type?: string;
  ref_id?: string;
  idempotency_key: string;
  metadata_json?: Record<string, unknown>;
}

export interface BillingCreditReserveInput {
  account_id?: string;
  external_key?: string;
  amount?: number;
  ref_type: string;
  ref_id: string;
  idempotency_key: string;
  operator_override?: boolean;
}

export interface BillingCreditConsumeInput {
  account_id?: string;
  external_key?: string;
  reservation_id?: string;
  ref_type?: string;
  ref_id?: string;
  idempotency_key: string;
}

export interface BillingCreditReleaseInput {
  account_id?: string;
  external_key?: string;
  reservation_id?: string;
  ref_type?: string;
  ref_id?: string;
  idempotency_key: string;
}

export interface BillingCreditReconcileInput {
  tenant_id?: string;
  limit?: number;
  timeout_minutes?: number;
  dry_run?: boolean;
}

export interface BillingSubscriptionCreateInput {
  tenant_id: string;
  account_id?: string;
  plan_name: string;
  monthly_credit_grant?: number;
  cycle_days?: number;
  currency?: string;
  price_monthly?: number;
  status?: BillingSubscriptionStatusValue;
  external_provider?: string;
  external_subscription_id?: string;
}

export interface BillingSubscriptionUpdateInput {
  status?: BillingSubscriptionStatusValue;
  external_provider?: string | null;
  external_subscription_id?: string | null;
}

export interface BillingSubscriptionRefillInput {
  idempotency_key?: string;
}

export interface BillingSubscriptionDueRefillInput {
  limit?: number;
  dry_run?: boolean;
}

export interface BillingSubscriptionWebhookInput {
  provider: 'stripe' | 'razorpay';
  event_id: string;
  event_type: string;
  payload_json: Record<string, unknown>;
  external_subscription_id?: string | null;
  tenant_id?: string | null;
}

export interface BillingUsageEventInput {
  source_system: 'v1' | 'v2';
  event_type: string;
  account_id?: string;
  external_account_key?: string;
  payload_json?: Record<string, unknown>;
  idempotency_key: string;
}

export interface ServiceInvoiceCreateItemInput {
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate?: number;
  tax_code?: string;
  service_code?: string;
  order_index?: number;
}

export interface ServiceInvoiceCreateInput {
  account_id?: string;
  external_key?: string;
  assignment_id?: string;
  channel_request_id?: string;
  issued_date?: string;
  due_date?: string;
  currency?: string;
  notes?: string;
  bill_to_name?: string;
  bill_to_address?: string;
  items?: ServiceInvoiceCreateItemInput[];
}

export interface ServiceInvoiceUpdateInput {
  notes?: string;
  bill_to_name?: string;
  bill_to_address?: string;
  due_date?: string | null;
  items?: ServiceInvoiceCreateItemInput[];
}

export interface ServiceInvoicePaymentInput {
  amount: number;
  mode?: string;
  reference?: string;
  notes?: string;
}

export interface ServiceInvoiceAdjustmentInput {
  amount: number;
  adjustment_type?: string;
  reason?: string;
}

const toDecimal = (value: Prisma.Decimal | string | number | bigint | null | undefined): Prisma.Decimal => {
  if (value === null || value === undefined) {
    return new Prisma.Decimal(0);
  }
  if (typeof value === 'bigint') {
    return new Prisma.Decimal(value.toString());
  }
  return new Prisma.Decimal(value);
};

const asInputJson = (value?: Record<string, unknown>): Prisma.InputJsonValue => {
  return (value ?? {}) as Prisma.InputJsonValue;
};

const decimalToNumber = (value: Prisma.Decimal | null | undefined): number => {
  if (!value) {
    return 0;
  }
  return Number(value.toString());
};

const toDateOnly = (value: string | Date | null | undefined): Date | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
  }
  return new Date(`${value}T00:00:00.000Z`);
};

const fyForDate = (issuedDate: Date): string => {
  const year = issuedDate.getUTCFullYear();
  const month = issuedDate.getUTCMonth() + 1;
  const fyStart = month >= 4 ? year : year - 1;
  const fyEnd = fyStart + 1;
  return `${String(fyStart).slice(-2)}-${String(fyEnd).slice(-2)}`;
};

const addDaysUtc = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const invoiceStatusOut = (status: ServiceInvoiceStatus): 'DRAFT' | 'ISSUED' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'VOID' => {
  const map: Record<ServiceInvoiceStatus, 'DRAFT' | 'ISSUED' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'VOID'> = {
    draft: 'DRAFT',
    issued: 'ISSUED',
    sent: 'SENT',
    partially_paid: 'PARTIALLY_PAID',
    paid: 'PAID',
    void: 'VOID'
  };
  return map[status];
};

const isKnownExternalKey = (value: string): boolean => {
  if (!value) {
    return false;
  }

  const v1 = /^v1:(partner|client|assignment|invoice):[A-Za-z0-9_-]+$/;
  const v2 = /^v2:(tenant|external):[A-Za-z0-9_-]+$/;
  return v1.test(value) || v2.test(value);
};

@Injectable()
export class BillingControlService {
  private studioServiceToken = process.env.STUDIO_SERVICE_TOKEN ?? '';

  requireStudioServiceToken(token?: string | null): void {
    if (!this.studioServiceToken) {
      throw new UnauthorizedException('STUDIO_SERVICE_TOKEN_NOT_CONFIGURED');
    }
    if (!token || token !== this.studioServiceToken) {
      throw new UnauthorizedException('INVALID_STUDIO_SERVICE_TOKEN');
    }
  }

  async listAccounts(tx: TxClient, search?: string) {
    const accounts = await tx.billingAccount.findMany({
      where: {
        ...(search
          ? {
              OR: [
                { displayName: { contains: search, mode: 'insensitive' } },
                { externalKey: { contains: search, mode: 'insensitive' } }
              ]
            }
          : {})
      },
      include: {
        policy: true
      },
      orderBy: [{ createdAt: 'desc' }]
    });

    return Promise.all(
      accounts.map(async (account) => {
        const status = await this.getAccountStatus(tx, account.id);
        return {
          id: account.id,
          tenant_id: account.tenantId,
          account_type: account.accountType.toUpperCase(),
          external_key: account.externalKey,
          display_name: account.displayName,
          status: account.status.toUpperCase(),
          policy: {
            billing_mode: status.billing_mode,
            payment_terms_days: status.payment_terms_days,
            credit_cost_model: status.credit_cost_model,
            currency: status.currency,
            is_enabled: status.is_enabled
          },
          credit: status.credit
        };
      })
    );
  }

  async createAccount(tx: TxClient, input: BillingAccountCreateInput) {
    const terms = input.payment_terms_days ?? 15;
    if (terms <= 0) {
      throw new BadRequestException('payment_terms_days must be positive');
    }
    this.assertExternalKey(input.external_key);

    const created = await tx.billingAccount.upsert({
      where: {
        externalKey: input.external_key
      },
      update: {
        tenantId: input.tenant_id,
        accountType: input.account_type,
        displayName: input.display_name,
        defaultPaymentTermsDays: terms,
        status: 'active'
      },
      create: {
        tenantId: input.tenant_id,
        accountType: input.account_type,
        displayName: input.display_name,
        externalKey: input.external_key,
        defaultPaymentTermsDays: terms,
        status: 'active'
      }
    });

    await this.ensureBillingPolicy(tx, created.id, {
      payment_terms_days: terms,
      currency: 'INR',
      is_enabled: true
    });
    await this.ensureCreditBalance(tx, created.id, created.tenantId);

    return this.getAccountStatus(tx, created.id);
  }

  async setAccountStatus(tx: TxClient, accountId: string, status: AccountStatus) {
    const account = await this.getAccountOr404(tx, { accountId });
    await tx.billingAccount.update({
      where: { id: account.id },
      data: { status }
    });
    return this.getAccountStatus(tx, account.id);
  }

  async getAccountStatus(tx: TxClient, accountId: string) {
    const account = await this.getAccountOr404(tx, { accountId });
    const policy = await this.ensureBillingPolicy(tx, account.id, {
      payment_terms_days: account.defaultPaymentTermsDays,
      currency: 'INR',
      is_enabled: true
    });
    const balances = await this.computeCreditBalances(tx, account.id);
    return {
      account_id: account.id,
      tenant_id: account.tenantId,
      account_type: account.accountType.toUpperCase(),
      external_key: account.externalKey,
      display_name: account.displayName,
      account_status: account.status.toUpperCase(),
      billing_mode: policy.billingMode.toUpperCase(),
      payment_terms_days: policy.paymentTermsDays,
      credit_cost_model: policy.creditCostModel.toUpperCase(),
      currency: policy.currency,
      is_enabled: policy.isEnabled,
      credit: balances
    };
  }

  async getAccountStatusByExternalKey(tx: TxClient, externalKey: string) {
    const account = await this.getAccountOr404(tx, { externalKey });
    return this.getAccountStatus(tx, account.id);
  }

  async getTenantCreditStatus(tx: TxClient, tenantId: string) {
    const accounts = await tx.billingAccount.findMany({
      where: {
        tenantId
      },
      include: {
        policy: true
      },
      orderBy: [{ createdAt: 'desc' }]
    });

    const summaries = await Promise.all(
      accounts.map(async (account) => {
        const policy =
          account.policy ??
          (await this.ensureBillingPolicy(tx, account.id, {
            payment_terms_days: account.defaultPaymentTermsDays,
            currency: 'INR',
            is_enabled: true
          }));
        const credit = await this.computeCreditBalances(tx, account.id);
        return {
          account_id: account.id,
          external_key: account.externalKey,
          display_name: account.displayName,
          account_type: account.accountType.toUpperCase(),
          account_status: account.status.toUpperCase(),
          billing_mode: policy.billingMode.toUpperCase(),
          payment_terms_days: policy.paymentTermsDays,
          credit
        };
      })
    );

    const totals = summaries.reduce(
      (acc, row) => ({
        balance_total: acc.balance_total + row.credit.wallet,
        reserved_total: acc.reserved_total + row.credit.reserved,
        available_total: acc.available_total + row.credit.available
      }),
      {
        balance_total: 0,
        reserved_total: 0,
        available_total: 0
      }
    );

    return {
      tenant_id: tenantId,
      account_count: summaries.length,
      ...totals,
      accounts: summaries
    };
  }

  async setBillingPolicy(tx: TxClient, accountId: string, input: BillingPolicyUpdateInput) {
    const account = await this.getAccountOr404(tx, { accountId });
    const previous = await this.ensureBillingPolicy(tx, account.id, {});
    if (input.billing_mode === 'credit') {
      const credit = await this.computeCreditBalances(tx, account.id);
      if (credit.available <= 0 && !input.force_enable_credit) {
        throw new ConflictException('available credits must be > 0 before enabling CREDIT mode');
      }
    }
    const policy = await this.ensureBillingPolicy(tx, account.id, input);
    if (previous.billingMode !== policy.billingMode) {
      await this.ingestUsageEvent(tx, {
        source_system: 'v2',
        event_type: policy.billingMode === 'credit' ? 'credit_mode_enabled' : 'credit_mode_disabled',
        account_id: account.id,
        payload_json: {
          previous_mode: previous.billingMode.toUpperCase(),
          next_mode: policy.billingMode.toUpperCase(),
          force_enable_credit: Boolean(input.force_enable_credit)
        },
        idempotency_key: `v2:policy_change:${account.id}:${policy.updatedAt.toISOString()}`
      });
    }
    return {
      account_id: account.id,
      billing_mode: policy.billingMode.toUpperCase(),
      payment_terms_days: policy.paymentTermsDays,
      credit_cost_model: policy.creditCostModel.toUpperCase(),
      currency: policy.currency,
      is_enabled: policy.isEnabled
    };
  }

  async listCreditLedger(tx: TxClient, accountId?: string) {
    const rows = await tx.billingCreditLedger.findMany({
      where: {
        ...(accountId ? { accountId } : {})
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 500
    });
    return rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenantId,
      account_id: row.accountId,
      reservation_id: row.reservationId,
      delta: row.delta,
      reason: row.reason.toUpperCase(),
      ref_type: row.refType,
      ref_id: row.refId,
      idempotency_key: row.idempotencyKey,
      metadata_json: row.metadataJson,
      created_at: row.createdAt.toISOString()
    }));
  }

  async listCreditReservations(
    tx: TxClient,
    input: {
      account_id?: string;
      tenant_id?: string;
      status?: ReservationStatus;
      limit?: number;
    }
  ) {
    const rows = await tx.billingCreditReservation.findMany({
      where: {
        ...(input.account_id ? { accountId: input.account_id } : {}),
        ...(input.tenant_id ? { tenantId: input.tenant_id } : {}),
        ...(input.status ? { status: input.status } : {})
      },
      orderBy: [{ createdAt: 'desc' }],
      take: Math.min(Math.max(input.limit ?? 200, 1), 500)
    });
    return rows.map((row) => this.serializeReservation(row));
  }

  async listBillingTimeline(
    tx: TxClient,
    input: {
      account_id?: string;
      tenant_id?: string;
      ref_type?: string;
      ref_id?: string;
      limit?: number;
    }
  ) {
    if (!input.account_id && !input.tenant_id) {
      throw new BadRequestException('account_id or tenant_id is required');
    }

    const take = Math.min(Math.max(input.limit ?? 120, 1), 500);
    const where = {
      ...(input.account_id ? { accountId: input.account_id } : {}),
      ...(input.tenant_id ? { tenantId: input.tenant_id } : {})
    };

    const [ledgerRows, usageRows, invoiceRows] = await Promise.all([
      tx.billingCreditLedger.findMany({
        where: {
          ...where,
          ...(input.ref_type ? { refType: input.ref_type } : {}),
          ...(input.ref_id ? { refId: input.ref_id } : {})
        },
        orderBy: [{ createdAt: 'desc' }],
        take
      }),
      tx.billingUsageEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take
      }),
      tx.serviceInvoice.findMany({
        where: {
          ...where,
          ...(input.ref_type === 'service_invoice' && input.ref_id ? { id: input.ref_id } : {})
        },
        orderBy: [{ updatedAt: 'desc' }],
        take
      })
    ]);

    const ledgerEvents = ledgerRows.map((row) => ({
      timestamp: row.createdAt.toISOString(),
      source: 'CREDITS_LEDGER',
      account_id: row.accountId,
      tenant_id: row.tenantId,
      event_type: row.reason.toUpperCase(),
      ref_type: row.refType,
      ref_id: row.refId,
      amount: row.delta,
      idempotency_key: row.idempotencyKey,
      payload_json: row.metadataJson
    }));

    const usageEvents = usageRows.map((row) => ({
      timestamp: row.createdAt.toISOString(),
      source: `USAGE_${row.sourceSystem.toUpperCase()}`,
      account_id: row.accountId,
      tenant_id: row.tenantId,
      event_type: row.eventType,
      ref_type: null as string | null,
      ref_id: null as string | null,
      amount: null as number | null,
      idempotency_key: row.idempotencyKey,
      payload_json: row.payloadJson
    }));

    const invoiceEvents = invoiceRows.map((row) => ({
      timestamp: row.updatedAt.toISOString(),
      source: 'SERVICE_INVOICE',
      account_id: row.accountId,
      tenant_id: row.tenantId,
      event_type: `INVOICE_${invoiceStatusOut(row.status)}`,
      ref_type: 'service_invoice',
      ref_id: row.id,
      amount: decimalToNumber(row.totalAmount),
      idempotency_key: null as string | null,
      payload_json: {
        invoice_id: row.id,
        invoice_number: row.invoiceNumber,
        status: invoiceStatusOut(row.status),
        amount_due: decimalToNumber(row.amountDue),
        amount_paid: decimalToNumber(row.amountPaid),
        is_paid: row.isPaid
      } as Prisma.JsonValue
    }));

    return [...ledgerEvents, ...usageEvents, ...invoiceEvents]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, take);
  }

  async grantCredits(tx: TxClient, accountId: string, input: BillingCreditGrantInput) {
    const reason: CreditReason = input.reason ?? 'grant';
    if (!['grant', 'topup', 'adjustment'].includes(reason)) {
      throw new BadRequestException('reason must be GRANT, TOPUP, or ADJUSTMENT');
    }
    if (input.amount <= 0) {
      throw new BadRequestException('amount must be positive');
    }

    const account = await this.getAccountOr404(tx, { accountId });
    const existing = await tx.billingCreditLedger.findUnique({
      where: {
        accountId_idempotencyKey: {
          accountId: account.id,
          idempotencyKey: input.idempotency_key
        }
      }
    });
    if (existing) {
      return this.getAccountStatus(tx, account.id);
    }

    const balance = await this.lockCreditBalance(tx, account.id, account.tenantId);
    const wallet = balance.wallet + input.amount;
    const reserved = balance.reserved;
    const available = wallet - reserved;
    if (wallet < 0 || reserved < 0 || available < 0) {
      throw new ConflictException('CREDIT_BALANCE_INVARIANT_FAILED');
    }

    await this.updateCreditBalance(tx, account.id, {
      wallet,
      reserved,
      available
    });

    await tx.billingCreditLedger.create({
      data: {
        tenantId: account.tenantId,
        accountId: account.id,
        delta: input.amount,
        reason,
        refType: input.ref_type ?? 'manual',
        refId: input.ref_id ?? 'manual-grant',
        idempotencyKey: input.idempotency_key,
        metadataJson: asInputJson(input.metadata_json)
      }
    });

    await this.ingestUsageEvent(tx, {
      source_system: 'v2',
      event_type: 'credits_granted',
      account_id: account.id,
      payload_json: {
        reason: reason.toUpperCase(),
        amount: input.amount,
        ref_type: input.ref_type ?? 'manual',
        ref_id: input.ref_id ?? 'manual-grant'
      },
      idempotency_key: `v2:credit_event:${input.idempotency_key}`
    });
    return this.getAccountStatus(tx, account.id);
  }

  async reserveCredits(tx: TxClient, input: BillingCreditReserveInput) {
    const amount = input.amount ?? 1;
    if (amount <= 0) {
      throw new BadRequestException('amount must be positive');
    }

    const account = await this.getAccountOr404(tx, {
      accountId: input.account_id,
      externalKey: input.external_key
    });
    const policy = await this.ensureBillingPolicy(tx, account.id, {
      payment_terms_days: account.defaultPaymentTermsDays,
      currency: 'INR',
      is_enabled: true
    });

    if (account.status !== 'active' || !policy.isEnabled) {
      throw new ConflictException('ACCOUNT_NOT_ACTIVE');
    }
    if (policy.billingMode !== 'credit') {
      throw new ConflictException('BILLING_MODE_NOT_CREDIT');
    }

    const existing = await tx.billingCreditReservation.findUnique({
      where: {
        accountId_idempotencyKey: {
          accountId: account.id,
          idempotencyKey: input.idempotency_key
        }
      }
    });
    if (existing) {
      return this.serializeReservation(existing);
    }

    const balance = await this.lockCreditBalance(tx, account.id, account.tenantId);

    let wallet = balance.wallet;
    let reserved = balance.reserved;
    let available = wallet - reserved;

    if (available < amount && !input.operator_override) {
      throw new ConflictException('INSUFFICIENT_CREDITS');
    }

    if (available < amount && input.operator_override) {
      const topupDelta = amount - available;
      wallet += topupDelta;
      available = wallet - reserved;

      const overrideKey = `${input.idempotency_key}:override`;
      const overrideLedger = await tx.billingCreditLedger.findUnique({
        where: {
          accountId_idempotencyKey: {
            accountId: account.id,
            idempotencyKey: overrideKey
          }
        }
      });

      if (!overrideLedger) {
        await tx.billingCreditLedger.create({
          data: {
            tenantId: account.tenantId,
            accountId: account.id,
            delta: topupDelta,
            reason: 'adjustment',
            refType: 'operator_override',
            refId: `${input.ref_type}:${input.ref_id}`,
            idempotencyKey: overrideKey,
            metadataJson: {
              reason: 'insufficient_credits_override',
              reserve_idempotency_key: input.idempotency_key
            }
          }
        });
      }
    }

    reserved += amount;
    available = wallet - reserved;
    if (wallet < 0 || reserved < 0 || available < 0) {
      throw new ConflictException('CREDIT_BALANCE_INVARIANT_FAILED');
    }

    const reservation = await tx.billingCreditReservation.create({
      data: {
        tenantId: account.tenantId,
        accountId: account.id,
        refType: input.ref_type,
        refId: input.ref_id,
        amount,
        status: 'active',
        idempotencyKey: input.idempotency_key
      }
    });

    await this.updateCreditBalance(tx, account.id, {
      wallet,
      reserved,
      available
    });

    await tx.billingCreditLedger.create({
      data: {
        tenantId: account.tenantId,
        accountId: account.id,
        reservationId: reservation.id,
        delta: amount,
        reason: 'reserve',
        refType: input.ref_type,
        refId: input.ref_id,
        idempotencyKey: input.idempotency_key,
        metadataJson: {
          event: 'reserve'
        }
      }
    });

    await this.ingestUsageEvent(tx, {
      source_system: 'v2',
      event_type: 'credit_reserved',
      account_id: account.id,
      payload_json: {
        reservation_id: reservation.id,
        amount,
        ref_type: input.ref_type,
        ref_id: input.ref_id,
        operator_override: Boolean(input.operator_override)
      },
      idempotency_key: `v2:credit_event:${input.idempotency_key}`
    });

    return this.serializeReservation(reservation);
  }

  async consumeCredits(tx: TxClient, input: BillingCreditConsumeInput) {
    const account = await this.getAccountOr404(tx, {
      accountId: input.account_id,
      externalKey: input.external_key
    });

    const existing = await tx.billingCreditLedger.findUnique({
      where: {
        accountId_idempotencyKey: {
          accountId: account.id,
          idempotencyKey: input.idempotency_key
        }
      }
    });
    if (existing) {
      return existing;
    }

    const balance = await this.lockCreditBalance(tx, account.id, account.tenantId);
    const reservation = await this.getReservationForSettlement(tx, account.id, input.reservation_id, input.ref_type, input.ref_id);
    if (reservation.status === 'consumed') {
      throw new ConflictException('RESERVATION_ALREADY_CONSUMED');
    }
    if (reservation.status === 'released') {
      throw new ConflictException('RESERVATION_ALREADY_RELEASED');
    }

    const wallet = balance.wallet - reservation.amount;
    const reserved = balance.reserved - reservation.amount;
    const available = wallet - reserved;
    if (wallet < 0 || reserved < 0 || available < 0) {
      throw new ConflictException('INSUFFICIENT_CREDITS');
    }

    await tx.billingCreditReservation.update({
      where: { id: reservation.id },
      data: {
        status: 'consumed',
        consumedAt: new Date()
      }
    });

    await this.updateCreditBalance(tx, account.id, {
      wallet,
      reserved,
      available
    });

    const row = await tx.billingCreditLedger.create({
      data: {
        tenantId: reservation.tenantId,
        accountId: reservation.accountId,
        reservationId: reservation.id,
        delta: -reservation.amount,
        reason: 'consume',
        refType: reservation.refType,
        refId: reservation.refId,
        idempotencyKey: input.idempotency_key,
        metadataJson: {
          event: 'consume'
        }
      }
    });

    await this.ingestUsageEvent(tx, {
      source_system: 'v2',
      event_type: 'credit_consumed',
      account_id: account.id,
      payload_json: {
        reservation_id: reservation.id,
        amount: reservation.amount,
        ref_type: reservation.refType,
        ref_id: reservation.refId
      },
      idempotency_key: `v2:credit_event:${input.idempotency_key}`
    });

    return row;
  }

  async releaseCredits(tx: TxClient, input: BillingCreditReleaseInput) {
    const account = await this.getAccountOr404(tx, {
      accountId: input.account_id,
      externalKey: input.external_key
    });

    const existing = await tx.billingCreditLedger.findUnique({
      where: {
        accountId_idempotencyKey: {
          accountId: account.id,
          idempotencyKey: input.idempotency_key
        }
      }
    });
    if (existing) {
      return existing;
    }

    const balance = await this.lockCreditBalance(tx, account.id, account.tenantId);
    const reservation = await this.getReservationForSettlement(tx, account.id, input.reservation_id, input.ref_type, input.ref_id);
    if (reservation.status === 'consumed') {
      throw new ConflictException('RESERVATION_ALREADY_CONSUMED');
    }
    if (reservation.status === 'released') {
      throw new ConflictException('RESERVATION_ALREADY_RELEASED');
    }

    const wallet = balance.wallet;
    const reserved = balance.reserved - reservation.amount;
    const available = wallet - reserved;
    if (wallet < 0 || reserved < 0 || available < 0) {
      throw new ConflictException('CREDIT_BALANCE_INVARIANT_FAILED');
    }

    await tx.billingCreditReservation.update({
      where: { id: reservation.id },
      data: {
        status: 'released',
        releasedAt: new Date()
      }
    });

    await this.updateCreditBalance(tx, account.id, {
      wallet,
      reserved,
      available
    });

    const row = await tx.billingCreditLedger.create({
      data: {
        tenantId: reservation.tenantId,
        accountId: reservation.accountId,
        reservationId: reservation.id,
        delta: reservation.amount,
        reason: 'release',
        refType: reservation.refType,
        refId: reservation.refId,
        idempotencyKey: input.idempotency_key,
        metadataJson: {
          event: 'release'
        }
      }
    });

    await this.ingestUsageEvent(tx, {
      source_system: 'v2',
      event_type: 'credit_released',
      account_id: account.id,
      payload_json: {
        reservation_id: reservation.id,
        amount: reservation.amount,
        ref_type: reservation.refType,
        ref_id: reservation.refId
      },
      idempotency_key: `v2:credit_event:${input.idempotency_key}`
    });

    return row;
  }

  async ingestUsageEvent(tx: TxClient, input: BillingUsageEventInput) {
    const existing = await tx.billingUsageEvent.findUnique({
      where: {
        sourceSystem_idempotencyKey: {
          sourceSystem: input.source_system,
          idempotencyKey: input.idempotency_key
        }
      }
    });
    if (existing) {
      return this.serializeUsageEvent(existing);
    }

    const account = await this.getAccountOrNull(tx, {
      accountId: input.account_id,
      externalKey: input.external_account_key
    });

    const row = await tx.billingUsageEvent.create({
      data: {
        tenantId: account?.tenantId ?? '11111111-1111-1111-1111-111111111111',
        sourceSystem: input.source_system,
        eventType: input.event_type,
        accountId: account?.id ?? null,
        externalAccountKey: input.external_account_key ?? account?.externalKey ?? null,
        payloadJson: asInputJson(input.payload_json),
        idempotencyKey: input.idempotency_key
      }
    });
    return this.serializeUsageEvent(row);
  }

  async listSubscriptions(tx: TxClient, tenantId?: string) {
    const rows = await tx.billingSubscription.findMany({
      where: {
        ...(tenantId ? { tenantId } : {})
      },
      include: {
        account: true,
        plan: true
      },
      orderBy: [{ createdAt: 'desc' }]
    });
    return rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenantId,
      account_id: row.accountId,
      account_display_name: row.account.displayName,
      plan_id: row.planId,
      plan_name: row.plan.name,
      monthly_credit_grant: row.plan.monthlyCreditAllowance,
      cycle_days: row.plan.cycleDays,
      currency: row.plan.currency,
      price_monthly: decimalToNumber(row.plan.priceMonthly),
      status: row.status.toUpperCase(),
      starts_at: row.startsAt.toISOString(),
      ends_at: row.endsAt?.toISOString() ?? null,
      current_period_start: row.currentPeriodStart?.toISOString() ?? null,
      current_period_end: row.currentPeriodEnd?.toISOString() ?? null,
      next_refill_at: row.nextRefillAt?.toISOString() ?? null,
      last_refilled_at: row.lastRefilledAt?.toISOString() ?? null,
      external_provider: row.externalProvider,
      external_subscription_id: row.externalSubscriptionId
    }));
  }

  async createSubscription(tx: TxClient, input: BillingSubscriptionCreateInput) {
    const account = input.account_id
      ? await this.getAccountOr404(tx, { accountId: input.account_id })
      : await this.getPrimaryTenantBillingAccount(tx, input.tenant_id);
    if (account.tenantId !== input.tenant_id) {
      throw new ConflictException('account does not belong to tenant');
    }

    const plan = await this.upsertSubscriptionPlan(tx, {
      name: input.plan_name,
      monthly_credit_grant: input.monthly_credit_grant,
      cycle_days: input.cycle_days,
      currency: input.currency,
      price_monthly: input.price_monthly
    });

    const startsAt = new Date();
    const periodStart = startsAt;
    const periodEnd = addDaysUtc(periodStart, plan.cycleDays);

    const created = await tx.billingSubscription.create({
      data: {
        tenantId: account.tenantId,
        accountId: account.id,
        planId: plan.id,
        status: input.status ?? 'active',
        startsAt,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        nextRefillAt: periodEnd,
        externalProvider: input.external_provider ?? null,
        externalSubscriptionId: input.external_subscription_id ?? null
      },
      include: {
        account: true,
        plan: true
      }
    });

    await tx.billingSubscriptionEvent.create({
      data: {
        tenantId: created.tenantId,
        subscriptionId: created.id,
        provider: 'internal',
        eventType: 'subscription_created',
        payloadJson: asInputJson({
          account_id: created.accountId,
          plan_name: created.plan.name
        }),
        idempotencyKey: `subscription_create:${created.id}`
      }
    });

    return {
      id: created.id,
      tenant_id: created.tenantId,
      account_id: created.accountId,
      plan_id: created.planId,
      plan_name: created.plan.name,
      status: created.status.toUpperCase(),
      next_refill_at: created.nextRefillAt?.toISOString() ?? null
    };
  }

  async updateSubscription(tx: TxClient, subscriptionId: string, input: BillingSubscriptionUpdateInput) {
    const current = await tx.billingSubscription.findFirst({
      where: {
        id: subscriptionId
      }
    });
    if (!current) {
      throw new NotFoundException(`subscription ${subscriptionId} not found`);
    }

    const updated = await tx.billingSubscription.update({
      where: {
        id: subscriptionId
      },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.status === 'cancelled' ? { endsAt: new Date(), nextRefillAt: null } : {}),
        ...(input.external_provider !== undefined ? { externalProvider: input.external_provider } : {}),
        ...(input.external_subscription_id !== undefined ? { externalSubscriptionId: input.external_subscription_id } : {})
      }
    });

    await tx.billingSubscriptionEvent.create({
      data: {
        tenantId: updated.tenantId,
        subscriptionId: updated.id,
        provider: 'internal',
        eventType: 'subscription_updated',
        payloadJson: asInputJson({
          status: updated.status,
          external_provider: updated.externalProvider,
          external_subscription_id: updated.externalSubscriptionId
        }),
        idempotencyKey: `subscription_update:${updated.id}:${updated.updatedAt.toISOString()}`
      }
    });

    return {
      id: updated.id,
      tenant_id: updated.tenantId,
      account_id: updated.accountId,
      status: updated.status.toUpperCase(),
      next_refill_at: updated.nextRefillAt?.toISOString() ?? null
    };
  }

  async refillSubscription(tx: TxClient, subscriptionId: string, input: BillingSubscriptionRefillInput = {}) {
    const subscription = await tx.billingSubscription.findFirst({
      where: {
        id: subscriptionId
      },
      include: {
        plan: true,
        account: true
      }
    });
    if (!subscription) {
      throw new NotFoundException(`subscription ${subscriptionId} not found`);
    }
    return this.applySubscriptionRefill(tx, subscription, input.idempotency_key, 'manual');
  }

  async processDueSubscriptionRefills(tx: TxClient, input: BillingSubscriptionDueRefillInput = {}) {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const now = new Date();
    const due = await tx.billingSubscription.findMany({
      where: {
        status: 'active',
        nextRefillAt: {
          lte: now
        }
      },
      include: {
        plan: true,
        account: true
      },
      orderBy: [{ nextRefillAt: 'asc' }],
      take: limit
    });

    if (input.dry_run) {
      return {
        dry_run: true,
        scanned: due.length,
        refilled: due.length,
        skipped: 0,
        errors: [] as Array<{ subscription_id: string; error: string }>
      };
    }

    let refilled = 0;
    let skipped = 0;
    const errors: Array<{ subscription_id: string; error: string }> = [];

    for (const row of due) {
      try {
        const result = await this.applySubscriptionRefill(
          tx,
          row,
          undefined,
          'scheduled'
        );
        if (result.duplicate) {
          skipped += 1;
        } else {
          refilled += 1;
        }
      } catch (error) {
        errors.push({
          subscription_id: row.id,
          error: error instanceof Error ? error.message : 'unknown'
        });
      }
    }

    return {
      dry_run: false,
      scanned: due.length,
      refilled,
      skipped,
      errors
    };
  }

  async assignSubscription(tx: TxClient, input: { account_id: string; plan_name: string; monthly_credit_allowance?: number; status?: 'active' | 'paused' | 'past_due' | 'cancelled' }) {
    const account = await this.getAccountOr404(tx, { accountId: input.account_id });
    return this.createSubscription(tx, {
      tenant_id: account.tenantId,
      account_id: account.id,
      plan_name: input.plan_name,
      monthly_credit_grant: input.monthly_credit_allowance,
      status: input.status
    });
  }

  async listServiceInvoices(tx: TxClient, tenantId: string, accountId?: string) {
    const rows = await tx.serviceInvoice.findMany({
      where: {
        tenantId,
        ...(accountId ? { accountId } : {})
      },
      orderBy: [{ createdAt: 'desc' }],
      include: {
        account: true
      }
    });
    return rows.map((row) => this.serializeInvoiceSummary(row));
  }

  async getServiceInvoice(tx: TxClient, tenantId: string, invoiceId: string) {
    const row = await tx.serviceInvoice.findFirst({
      where: {
        id: invoiceId,
        tenantId
      },
      include: {
        account: true,
        items: {
          orderBy: { orderIndex: 'asc' }
        },
        payments: {
          orderBy: { paidAt: 'desc' }
        },
        adjustments: {
          orderBy: { createdAt: 'desc' }
        },
        attachments: {
          orderBy: { createdAt: 'desc' }
        },
        auditLogs: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });
    if (!row) {
      throw new NotFoundException(`invoice ${invoiceId} not found`);
    }
    return this.serializeInvoiceDetail(row);
  }

  async createServiceInvoice(tx: TxClient, tenantId: string, actorUserId: string | null, input: ServiceInvoiceCreateInput) {
    const account = await this.resolveOrCreateAccountForTenant(tx, tenantId, input.account_id, input.external_key);
    await this.ensureBillingPolicy(tx, account.id, {
      payment_terms_days: account.defaultPaymentTermsDays,
      currency: input.currency ?? 'INR',
      is_enabled: true
    });

    const created = await tx.serviceInvoice.create({
      data: {
        tenantId,
        accountId: account.id,
        assignmentId: input.assignment_id ?? null,
        channelRequestId: input.channel_request_id ?? null,
        status: 'draft',
        issuedDate: toDateOnly(input.issued_date),
        dueDate: toDateOnly(input.due_date),
        currency: input.currency ?? 'INR',
        notes: input.notes ?? null,
        billToName: input.bill_to_name ?? account.displayName,
        billToAddress: input.bill_to_address ?? null,
        createdByUserId: actorUserId
      }
    });

    await this.replaceInvoiceItems(tx, created.id, tenantId, input.items ?? [], input.assignment_id);
    await this.recomputeServiceInvoice(tx, created.id);
    await this.addInvoiceAudit(tx, created.id, tenantId, 'created', actorUserId, {
      assignment_id: input.assignment_id ?? null,
      channel_request_id: input.channel_request_id ?? null
    });
    await this.ingestUsageEvent(tx, {
      source_system: 'v2',
      event_type: 'invoice_created',
      account_id: account.id,
      payload_json: {
        invoice_id: created.id,
        tenant_id: tenantId
      },
      idempotency_key: `v2:invoice_created:${created.id}`
    });
    return this.getServiceInvoice(tx, tenantId, created.id);
  }

  async updateServiceInvoice(tx: TxClient, tenantId: string, invoiceId: string, actorUserId: string | null, input: ServiceInvoiceUpdateInput) {
    const row = await tx.serviceInvoice.findFirst({
      where: { id: invoiceId, tenantId }
    });
    if (!row) {
      throw new NotFoundException(`invoice ${invoiceId} not found`);
    }
    if (row.status !== 'draft') {
      throw new ConflictException('Only DRAFT invoices can be updated');
    }

    await tx.serviceInvoice.update({
      where: { id: row.id },
      data: {
        notes: input.notes ?? row.notes,
        billToName: input.bill_to_name ?? row.billToName,
        billToAddress: input.bill_to_address ?? row.billToAddress,
        dueDate: input.due_date === undefined ? row.dueDate : toDateOnly(input.due_date)
      }
    });

    if (input.items) {
      await this.replaceInvoiceItems(tx, row.id, tenantId, input.items, row.assignmentId ?? undefined);
    }
    await this.recomputeServiceInvoice(tx, row.id);
    await this.addInvoiceAudit(tx, row.id, tenantId, 'edited', actorUserId, input as Record<string, unknown>);
    return this.getServiceInvoice(tx, tenantId, row.id);
  }

  async issueServiceInvoice(
    tx: TxClient,
    tenantId: string,
    invoiceId: string,
    actorUserId: string | null,
    issuedDate?: string,
    dueDate?: string,
    idempotencyKey?: string | null
  ) {
    const row = await tx.serviceInvoice.findFirst({
      where: { id: invoiceId, tenantId }
    });
    if (!row) {
      throw new NotFoundException(`invoice ${invoiceId} not found`);
    }

    const requestHash = `invoice_issue:${invoiceId}:${issuedDate ?? ''}:${dueDate ?? ''}`;
    if (idempotencyKey) {
      const existing = await tx.serviceIdempotencyKey.findUnique({
        where: {
          accountId_scope_key: {
            accountId: row.accountId,
            scope: 'invoice_issue',
            key: idempotencyKey
          }
        }
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ConflictException('Idempotency key mismatch');
        }
        return this.getServiceInvoice(tx, tenantId, row.id);
      }
    }

    if (row.status !== 'draft') {
      throw new ConflictException('Invoice already issued');
    }

    const issueDate = toDateOnly(issuedDate) ?? new Date();
    const number = await this.nextInvoiceNumber(tx, tenantId, row.accountId, issueDate);
    await tx.serviceInvoice.update({
      where: { id: row.id },
      data: {
        invoiceNumber: number,
        issuedDate: issueDate,
        dueDate: dueDate ? toDateOnly(dueDate) : row.dueDate,
        status: 'issued'
      }
    });
    await this.recomputeServiceInvoice(tx, row.id);
    await this.addInvoiceAudit(tx, row.id, tenantId, 'issued', actorUserId, {
      issued_date: issueDate.toISOString().slice(0, 10),
      invoice_number: number
    });
    await this.ingestUsageEvent(tx, {
      source_system: 'v2',
      event_type: 'invoice_issued',
      account_id: row.accountId,
      payload_json: {
        invoice_id: row.id,
        invoice_number: number
      },
      idempotency_key: `v2:invoice_issued:${row.id}`
    });
    const invoice = await this.getServiceInvoice(tx, tenantId, row.id);
    if (idempotencyKey) {
      await tx.serviceIdempotencyKey.create({
        data: {
          tenantId,
          accountId: row.accountId,
          scope: 'invoice_issue',
          key: idempotencyKey,
          requestHash,
          responseJson: {
            invoice_id: row.id,
            invoice_number: number
          }
        }
      });
    }
    return invoice;
  }

  async sendServiceInvoice(tx: TxClient, tenantId: string, invoiceId: string, actorUserId: string | null) {
    const row = await tx.serviceInvoice.findFirst({
      where: { id: invoiceId, tenantId }
    });
    if (!row) {
      throw new NotFoundException(`invoice ${invoiceId} not found`);
    }
    if (!['issued', 'sent', 'partially_paid'].includes(row.status)) {
      throw new ConflictException('Invoice not in sendable state');
    }

    await tx.serviceInvoice.update({
      where: { id: row.id },
      data: {
        sentAt: new Date(),
        status: row.status === 'issued' ? 'sent' : row.status
      }
    });
    await this.recomputeServiceInvoice(tx, row.id);
    await this.addInvoiceAudit(tx, row.id, tenantId, 'sent', actorUserId, {});
    await this.ingestUsageEvent(tx, {
      source_system: 'v2',
      event_type: 'invoice_sent',
      account_id: row.accountId,
      payload_json: {
        invoice_id: row.id
      },
      idempotency_key: `v2:invoice_sent:${row.id}`
    });
    return this.getServiceInvoice(tx, tenantId, row.id);
  }

  async voidServiceInvoice(tx: TxClient, tenantId: string, invoiceId: string, actorUserId: string | null, reason: string) {
    const row = await tx.serviceInvoice.findFirst({
      where: { id: invoiceId, tenantId }
    });
    if (!row) {
      throw new NotFoundException(`invoice ${invoiceId} not found`);
    }
    if (row.status === 'void') {
      return this.getServiceInvoice(tx, tenantId, row.id);
    }
    if (decimalToNumber(row.amountPaid) > 0) {
      throw new ConflictException('Cannot void invoice with payments');
    }

    await tx.serviceInvoice.update({
      where: { id: row.id },
      data: {
        status: 'void',
        voidedAt: new Date(),
        voidReason: reason,
        amountDue: new Prisma.Decimal(0),
        isPaid: false
      }
    });
    await this.addInvoiceAudit(tx, row.id, tenantId, 'voided', actorUserId, { reason });
    await this.ingestUsageEvent(tx, {
      source_system: 'v2',
      event_type: 'invoice_voided',
      account_id: row.accountId,
      payload_json: {
        invoice_id: row.id,
        reason
      },
      idempotency_key: `v2:invoice_voided:${row.id}`
    });
    return this.getServiceInvoice(tx, tenantId, row.id);
  }

  async addServiceInvoicePayment(
    tx: TxClient,
    tenantId: string,
    invoiceId: string,
    actorUserId: string | null,
    input: ServiceInvoicePaymentInput,
    idempotencyKey?: string | null
  ) {
    const row = await tx.serviceInvoice.findFirst({
      where: { id: invoiceId, tenantId }
    });
    if (!row) {
      throw new NotFoundException(`invoice ${invoiceId} not found`);
    }
    if (row.status === 'void' || row.status === 'draft') {
      throw new ConflictException('Invoice is not payable');
    }
    if (input.amount <= 0) {
      throw new BadRequestException('amount must be positive');
    }
    const due = decimalToNumber(row.amountDue);
    if (due <= 0) {
      throw new ConflictException('Invoice already settled');
    }
    if (input.amount > due) {
      throw new BadRequestException('amount exceeds due');
    }

    const normalizedMode = input.mode ?? 'manual';
    const requestHash = `invoice_payment:${invoiceId}:${input.amount}:${normalizedMode}:${input.reference ?? ''}:${input.notes ?? ''}`;

    if (idempotencyKey) {
      const existing = await tx.serviceIdempotencyKey.findUnique({
        where: {
          accountId_scope_key: {
            accountId: row.accountId,
            scope: 'invoice_payment',
            key: idempotencyKey
          }
        }
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ConflictException('Idempotency key mismatch');
        }
        return this.getServiceInvoice(tx, tenantId, row.id);
      }
      try {
        await tx.serviceIdempotencyKey.create({
          data: {
            tenantId,
            accountId: row.accountId,
            scope: 'invoice_payment',
            key: idempotencyKey,
            requestHash,
            responseJson: {
              status: 'pending'
            }
          }
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const raced = await tx.serviceIdempotencyKey.findUnique({
            where: {
              accountId_scope_key: {
                accountId: row.accountId,
                scope: 'invoice_payment',
                key: idempotencyKey
              }
            }
          });
          if (raced && raced.requestHash === requestHash) {
            return this.getServiceInvoice(tx, tenantId, row.id);
          }
          throw new ConflictException('Idempotency key mismatch');
        }
        throw error;
      }
    }

    const payment = await tx.serviceInvoicePayment.create({
      data: {
        tenantId,
        invoiceId: row.id,
        amount: new Prisma.Decimal(input.amount),
        mode: normalizedMode,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        createdByUserId: actorUserId
      }
    });
    const updated = await this.recomputeServiceInvoice(tx, row.id);
    await this.addInvoiceAudit(tx, row.id, tenantId, 'payment_recorded', actorUserId, {
      amount: input.amount,
      mode: input.mode ?? 'manual'
    });
    await this.ingestUsageEvent(tx, {
      source_system: 'v2',
      event_type: updated.status === 'paid' ? 'invoice_paid' : 'payment_recorded',
      account_id: row.accountId,
      payload_json: {
        invoice_id: row.id,
        amount: input.amount
      },
      idempotency_key: `v2:payment:${row.id}:${idempotencyKey ?? payment.id}`
    });

    const invoice = await this.getServiceInvoice(tx, tenantId, row.id);
    if (idempotencyKey) {
      await tx.serviceIdempotencyKey.update({
        where: {
          accountId_scope_key: {
            accountId: row.accountId,
            scope: 'invoice_payment',
            key: idempotencyKey
          }
        },
        data: {
          responseJson: {
            invoice_id: invoice.id,
            status: invoice.status,
            amount_due: invoice.amount_due,
            amount_paid: invoice.amount_paid
          }
        }
      });
    }

    return invoice;
  }

  async addServiceInvoiceAdjustment(tx: TxClient, tenantId: string, invoiceId: string, actorUserId: string | null, input: ServiceInvoiceAdjustmentInput) {
    const row = await tx.serviceInvoice.findFirst({
      where: { id: invoiceId, tenantId }
    });
    if (!row) {
      throw new NotFoundException(`invoice ${invoiceId} not found`);
    }
    if (row.status === 'void' || row.status === 'draft') {
      throw new ConflictException('Invoice is not adjustable');
    }
    if (input.amount <= 0) {
      throw new BadRequestException('amount must be positive');
    }

    await tx.serviceInvoiceAdjustment.create({
      data: {
        tenantId,
        invoiceId: row.id,
        amount: new Prisma.Decimal(input.amount),
        adjustmentType: input.adjustment_type ?? 'credit',
        reason: input.reason ?? null,
        createdByUserId: actorUserId
      }
    });
    await this.recomputeServiceInvoice(tx, row.id);
    await this.addInvoiceAudit(tx, row.id, tenantId, 'adjustment_added', actorUserId, {
      amount: input.amount,
      adjustment_type: input.adjustment_type ?? 'credit'
    });
    return this.getServiceInvoice(tx, tenantId, row.id);
  }

  async remindServiceInvoice(
    tx: TxClient,
    tenantId: string,
    invoiceId: string,
    accountId: string,
    idempotencyKey: string | null
  ) {
    const row = await tx.serviceInvoice.findFirst({
      where: { id: invoiceId, tenantId }
    });
    if (!row) {
      throw new NotFoundException(`invoice ${invoiceId} not found`);
    }
    if (row.status === 'void' || decimalToNumber(row.amountDue) <= 0) {
      throw new ConflictException('Invoice already settled or voided');
    }

    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    const requestHash = `invoice_remind:${invoiceId}`;
    const existing = await tx.serviceIdempotencyKey.findUnique({
      where: {
        accountId_scope_key: {
          accountId,
          scope: 'invoice_remind',
          key: idempotencyKey
        }
      }
    });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException('Idempotency key mismatch');
      }
      return existing.responseJson ?? { status: 'ok', invoice_id: invoiceId };
    }

    const response = {
      status: 'ok',
      invoice_id: invoiceId,
      message: `Reminder recorded for ${row.invoiceNumber ?? row.id}`
    };

    await tx.serviceIdempotencyKey.create({
      data: {
        tenantId,
        accountId,
        scope: 'invoice_remind',
        key: idempotencyKey,
        requestHash,
        responseJson: response
      }
    });

    await this.addInvoiceAudit(tx, row.id, tenantId, 'reminder_sent', null, {
      idempotency_key: idempotencyKey
    });
    return response;
  }

  async addServiceInvoiceAttachment(
    tx: TxClient,
    tenantId: string,
    invoiceId: string,
    actorUserId: string | null,
    input: { kind: 'invoice_document' | 'payment_proof' | 'other'; original_name: string; storage_key: string; mime_type?: string; size_bytes?: number }
  ) {
    const row = await tx.serviceInvoice.findFirst({
      where: { id: invoiceId, tenantId }
    });
    if (!row) {
      throw new NotFoundException(`invoice ${invoiceId} not found`);
    }

    const created = await tx.serviceInvoiceAttachment.create({
      data: {
        tenantId,
        invoiceId: row.id,
        kind: input.kind,
        originalName: input.original_name,
        storageKey: input.storage_key,
        mimeType: input.mime_type ?? null,
        sizeBytes: BigInt(input.size_bytes ?? 0),
        uploadedByUserId: actorUserId
      }
    });
    await this.addInvoiceAudit(tx, row.id, tenantId, 'attachment_added', actorUserId, {
      attachment_id: created.id,
      kind: created.kind
    });
    return {
      id: created.id,
      invoice_id: created.invoiceId,
      kind: created.kind.toUpperCase(),
      original_name: created.originalName,
      storage_key: created.storageKey,
      created_at: created.createdAt.toISOString()
    };
  }

  async getServiceInvoiceContext(tx: TxClient, tenantId: string, invoiceId: string) {
    const invoice = await this.getServiceInvoice(tx, tenantId, invoiceId);
    const account = await this.getAccountStatus(tx, invoice.account_id);
    return {
      invoice,
      account
    };
  }

  async ensureChannelAcceptanceBilling(
    tx: TxClient,
    input: {
      tenant_id: string;
      channel_request_id: string;
      requested_by_user_id: string;
      borrower_name: string;
      assignment_id?: string | null;
      fee_paise?: bigint | null;
    }
  ) {
    const externalKey = `v2:external:${input.requested_by_user_id}`;
    const account = await this.resolveOrCreateAccountForTenant(tx, input.tenant_id, undefined, externalKey, 'external_associate');
    const policy = await this.ensureBillingPolicy(tx, account.id, {
      payment_terms_days: account.defaultPaymentTermsDays,
      currency: 'INR',
      is_enabled: true
    });

    if (policy.billingMode === 'credit') {
      const reservation = await this.reserveCredits(tx, {
        account_id: account.id,
        amount: 1,
        ref_type: 'channel_request',
        ref_id: input.channel_request_id,
        idempotency_key: `channel_accept:${input.channel_request_id}`
      });
      await this.ingestUsageEvent(tx, {
        source_system: 'v2',
        event_type: 'work_accepted',
        account_id: account.id,
        payload_json: {
          channel_request_id: input.channel_request_id,
          assignment_id: input.assignment_id
        },
        idempotency_key: `v2:work_accepted:${input.channel_request_id}`
      });
      return {
        mode: 'CREDIT' as const,
        account_id: account.id,
        reservation_id: reservation.id,
        service_invoice_id: null
      };
    }

    const existing = await tx.serviceInvoice.findFirst({
      where: {
        tenantId: input.tenant_id,
        channelRequestId: input.channel_request_id
      }
    });
    const amount = Number((input.fee_paise ?? BigInt(10000)).toString()) / 100;
    const invoice = existing
      ? await this.getServiceInvoice(tx, input.tenant_id, existing.id)
      : await this.createServiceInvoice(tx, input.tenant_id, null, {
          account_id: account.id,
          assignment_id: input.assignment_id ?? undefined,
          channel_request_id: input.channel_request_id,
          items: [
            {
              description: `Commissioned work - ${input.borrower_name}`,
              quantity: 1,
              unit_price: amount > 0 ? amount : 100,
              order_index: 0
            }
          ]
        });

    if (invoice.status === 'DRAFT') {
      await this.issueServiceInvoice(tx, input.tenant_id, invoice.id, null);
    }

    await this.ingestUsageEvent(tx, {
      source_system: 'v2',
      event_type: 'work_accepted',
      account_id: account.id,
      payload_json: {
        channel_request_id: input.channel_request_id,
        service_invoice_id: invoice.id
      },
      idempotency_key: `v2:work_accepted:${input.channel_request_id}`
    });

    return {
      mode: 'POSTPAID' as const,
      account_id: account.id,
      reservation_id: null,
      service_invoice_id: invoice.id
    };
  }

  async markChannelDeliveredBillingSatisfied(
    tx: TxClient,
    input: {
      tenant_id: string;
      channel_request_id: string;
      account_id?: string | null;
      reservation_id?: string | null;
      service_invoice_id?: string | null;
    }
  ) {
    if (input.reservation_id && input.account_id) {
      await this.consumeCredits(tx, {
        account_id: input.account_id,
        reservation_id: input.reservation_id,
        idempotency_key: `channel_delivered_consume:${input.channel_request_id}`
      });
    }
    await this.ingestUsageEvent(tx, {
      source_system: 'v2',
      event_type: 'work_delivered',
      account_id: input.account_id ?? undefined,
      payload_json: {
        channel_request_id: input.channel_request_id,
        reservation_id: input.reservation_id,
        service_invoice_id: input.service_invoice_id
      },
      idempotency_key: `v2:work_delivered:${input.channel_request_id}`
    });
  }

  async markChannelCancelledRelease(
    tx: TxClient,
    input: {
      channel_request_id: string;
      account_id?: string | null;
      reservation_id?: string | null;
    }
  ) {
    if (input.reservation_id && input.account_id) {
      await this.releaseCredits(tx, {
        account_id: input.account_id,
        reservation_id: input.reservation_id,
        idempotency_key: `channel_cancel_release:${input.channel_request_id}`
      });
    }
    await this.ingestUsageEvent(tx, {
      source_system: 'v2',
      event_type: 'work_cancelled',
      account_id: input.account_id ?? undefined,
      payload_json: {
        channel_request_id: input.channel_request_id,
        reservation_id: input.reservation_id
      },
      idempotency_key: `v2:work_cancelled:${input.channel_request_id}`
    });
  }

  async reconcileCredits(tx: TxClient, input: BillingCreditReconcileInput = {}) {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const configuredTimeout = Number.parseInt(process.env.BILLING_RESERVATION_TIMEOUT_MINUTES ?? '1440', 10);
    const timeoutMinutes = Math.max(input.timeout_minutes ?? (Number.isFinite(configuredTimeout) ? configuredTimeout : 1440), 5);
    const now = new Date();

    const reservations = await tx.billingCreditReservation.findMany({
      where: {
        status: 'active',
        ...(input.tenant_id ? { tenantId: input.tenant_id } : {}),
        refType: 'channel_request'
      },
      orderBy: [{ createdAt: 'asc' }],
      take: limit
    });

    if (reservations.length === 0) {
      return {
        dry_run: Boolean(input.dry_run),
        scanned: 0,
        consumed: 0,
        released: 0,
        skipped: 0,
        errors: [] as Array<{ reservation_id: string; error: string }>
      };
    }

    const channelRequestIds = Array.from(new Set(reservations.map((row) => row.refId)));
    const channelRequests = await tx.channelRequest.findMany({
      where: {
        id: {
          in: channelRequestIds
        }
      },
      select: {
        id: true,
        tenantId: true,
        status: true,
        assignmentId: true,
        serviceInvoiceId: true
      }
    });
    const channelById = new Map(channelRequests.map((row) => [row.id, row]));

    const assignmentIds = Array.from(new Set(channelRequests.map((row) => row.assignmentId).filter((value): value is string => Boolean(value))));
    const assignments = assignmentIds.length
      ? await tx.assignment.findMany({
          where: {
            id: {
              in: assignmentIds
            }
          },
          select: {
            id: true,
            status: true
          }
        })
      : [];
    const assignmentById = new Map(assignments.map((row) => [row.id, row]));

    let consumed = 0;
    let released = 0;
    let skipped = 0;
    const errors: Array<{ reservation_id: string; error: string }> = [];

    for (const reservation of reservations) {
      const channel = channelById.get(reservation.refId);
      const ageMinutes = Math.floor((now.getTime() - reservation.createdAt.getTime()) / 60_000);
      const isTimedOut = ageMinutes >= timeoutMinutes;
      const assignment = channel?.assignmentId ? assignmentById.get(channel.assignmentId) : undefined;
      const assignmentStatus = assignment?.status ?? null;

      let action: 'consume' | 'release' | 'skip' = 'skip';
      let reason: 'delivered' | 'cancelled' | 'rejected' | 'timeout' | 'orphan' | 'pending' = 'pending';

      if (!channel) {
        if (isTimedOut) {
          action = 'release';
          reason = 'orphan';
        }
      } else if (channel.status === 'rejected') {
        action = 'release';
        reason = 'rejected';
      } else if (assignmentStatus === 'cancelled') {
        action = 'release';
        reason = 'cancelled';
      } else if (assignmentStatus === 'delivered') {
        action = 'consume';
        reason = 'delivered';
      } else if (isTimedOut) {
        action = 'release';
        reason = 'timeout';
      }

      if (action === 'skip') {
        skipped += 1;
        continue;
      }

      if (input.dry_run) {
        if (action === 'consume') {
          consumed += 1;
        } else {
          released += 1;
        }
        continue;
      }

      try {
        if (action === 'consume' && channel) {
          await this.markChannelDeliveredBillingSatisfied(tx, {
            tenant_id: channel.tenantId,
            channel_request_id: channel.id,
            account_id: reservation.accountId,
            reservation_id: reservation.id,
            service_invoice_id: channel.serviceInvoiceId
          });
          consumed += 1;
          continue;
        }

        await this.releaseCredits(tx, {
          account_id: reservation.accountId,
          reservation_id: reservation.id,
          idempotency_key: `reconcile_release:${reservation.id}:${reason}`
        });

        if (channel) {
          await this.ingestUsageEvent(tx, {
            source_system: 'v2',
            event_type: reason === 'timeout' ? 'work_timed_out' : 'work_cancelled',
            account_id: reservation.accountId,
            payload_json: {
              channel_request_id: channel.id,
              reservation_id: reservation.id,
              reconciliation_reason: reason
            },
            idempotency_key: `v2:reconcile_release:${reservation.id}:${reason}`
          });
        }

        released += 1;
      } catch (error) {
        errors.push({
          reservation_id: reservation.id,
          error: error instanceof Error ? error.message : 'unknown'
        });
      }
    }

    return {
      dry_run: Boolean(input.dry_run),
      scanned: reservations.length,
      consumed,
      released,
      skipped,
      errors
    };
  }

  async getTenantSubscription(tx: TxClient, tenantId: string) {
    const row = await tx.billingSubscription.findFirst({
      where: {
        tenantId,
        status: {
          in: ['active', 'paused', 'past_due']
        }
      },
      include: {
        plan: true
      },
      orderBy: [{ createdAt: 'desc' }]
    });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      tenant_id: row.tenantId,
      account_id: row.accountId,
      plan_id: row.planId,
      plan_name: row.plan.name,
      status: row.status.toUpperCase(),
      monthly_credit_grant: row.plan.monthlyCreditAllowance,
      cycle_days: row.plan.cycleDays,
      currency: row.plan.currency,
      next_refill_at: row.nextRefillAt?.toISOString() ?? null,
      current_period_start: row.currentPeriodStart?.toISOString() ?? null,
      current_period_end: row.currentPeriodEnd?.toISOString() ?? null
    };
  }

  async getTenantCreditSummary(tx: TxClient, tenantId: string) {
    const accounts = await tx.billingAccount.findMany({
      where: {
        tenantId,
        status: 'active'
      },
      orderBy: [{ createdAt: 'asc' }]
    });
    if (accounts.length === 0) {
      return {
        tenant_id: tenantId,
        account_count: 0,
        wallet: 0,
        reserved: 0,
        available: 0,
        primary_account_id: null
      };
    }
    const balances = await Promise.all(accounts.map((row) => this.computeCreditBalances(tx, row.id)));
    const totals = balances.reduce(
      (acc, row) => {
        acc.wallet += row.wallet;
        acc.reserved += row.reserved;
        acc.available += row.available;
        return acc;
      },
      { wallet: 0, reserved: 0, available: 0 }
    );
    return {
      tenant_id: tenantId,
      account_count: accounts.length,
      wallet: totals.wallet,
      reserved: totals.reserved,
      available: totals.available,
      primary_account_id: accounts[0]?.id ?? null
    };
  }

  async onboardTenant(
    tx: TxClient,
    input: {
      tenant_name: string;
      owner_email: string;
      account_type: AccountType;
      display_name: string;
      external_key: string;
    }
  ) {
    const baseSlug = input.tenant_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    const slugCandidate = baseSlug || `tenant-${Date.now()}`;
    const existingSlug = await tx.tenant.findFirst({
      where: {
        slug: slugCandidate
      }
    });
    const slug = existingSlug ? `${slugCandidate}-${Date.now().toString().slice(-6)}` : slugCandidate;

    const tenant = await tx.tenant.create({
      data: {
        name: input.tenant_name,
        slug,
        lane: 'tenant'
      }
    });

    const owner = await tx.user.upsert({
      where: {
        email: input.owner_email
      },
      update: {},
      create: {
        email: input.owner_email,
        name: input.owner_email.split('@')[0] ?? input.owner_email
      }
    });

    const role = await tx.role.findFirst({
      where: {
        name: 'super_admin'
      }
    });
    if (role) {
      await tx.membership.upsert({
        where: {
          tenantId_userId_roleId: {
            tenantId: tenant.id,
            userId: owner.id,
            roleId: role.id
          }
        },
        update: {},
        create: {
          tenantId: tenant.id,
          userId: owner.id,
          roleId: role.id
        }
      });
    }

    const account = await this.createAccount(tx, {
      tenant_id: tenant.id,
      account_type: input.account_type,
      display_name: input.display_name,
      external_key: input.external_key,
      payment_terms_days: 15
    });

    await this.setBillingPolicy(tx, account.account_id, {
      billing_mode: 'postpaid',
      payment_terms_days: 15,
      currency: 'INR',
      is_enabled: true
    });

    await this.ingestUsageEvent(tx, {
      source_system: 'v2',
      event_type: 'billing_onboarded',
      account_id: account.account_id,
      payload_json: {
        tenant_id: tenant.id,
        owner_email: input.owner_email
      },
      idempotency_key: `v2:onboard:${tenant.id}:${account.account_id}`
    });

    return {
      tenant_id: tenant.id,
      tenant_slug: tenant.slug,
      owner_user_id: owner.id,
      account_id: account.account_id,
      billing_mode: 'POSTPAID'
    };
  }

  async ingestSubscriptionWebhook(tx: TxClient, input: BillingSubscriptionWebhookInput) {
    const existing = await tx.billingSubscriptionEvent.findUnique({
      where: {
        provider_idempotencyKey: {
          provider: input.provider,
          idempotencyKey: input.event_id
        }
      }
    });
    if (existing) {
      return {
        duplicate: true,
        event_id: existing.id
      };
    }

    const subscription = input.external_subscription_id
      ? await tx.billingSubscription.findFirst({
          where: {
            externalSubscriptionId: input.external_subscription_id
          }
        })
      : null;
    const tenantId =
      subscription?.tenantId ??
      input.tenant_id ??
      process.env.ZENOPS_INTERNAL_TENANT_ID ??
      '11111111-1111-1111-1111-111111111111';

    if (subscription) {
      const eventType = input.event_type.toLowerCase();
      if (eventType.includes('cancel')) {
        await tx.billingSubscription.update({
          where: { id: subscription.id },
          data: {
            status: 'cancelled',
            endsAt: new Date(),
            nextRefillAt: null
          }
        });
      } else if (eventType.includes('resume') || eventType.includes('activated')) {
        await tx.billingSubscription.update({
          where: { id: subscription.id },
          data: {
            status: 'active'
          }
        });
      }
    }

    const created = await tx.billingSubscriptionEvent.create({
      data: {
        tenantId,
        subscriptionId: subscription?.id ?? null,
        provider: input.provider,
        eventType: input.event_type,
        payloadJson: asInputJson(input.payload_json),
        idempotencyKey: input.event_id
      }
    });

    return {
      duplicate: false,
      event_id: created.id
    };
  }

  async isAssignmentBillingSatisfied(tx: TxClient, tenantId: string, assignmentId: string): Promise<boolean> {
    const rows = await tx.serviceInvoice.findMany({
      where: {
        tenantId,
        assignmentId
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 20
    });
    if (rows.length === 0) {
      return false;
    }
    return rows.some((row) => row.status === 'paid');
  }

  private async getPrimaryTenantBillingAccount(tx: TxClient, tenantId: string) {
    const account = await tx.billingAccount.findFirst({
      where: {
        tenantId,
        status: 'active'
      },
      orderBy: [{ createdAt: 'asc' }]
    });
    if (!account) {
      throw new NotFoundException(`no billing account found for tenant ${tenantId}`);
    }
    return account;
  }

  private async upsertSubscriptionPlan(
    tx: TxClient,
    input: {
      name: string;
      monthly_credit_grant?: number;
      cycle_days?: number;
      currency?: string;
      price_monthly?: number;
    }
  ) {
    const existing = await tx.billingPlanCatalog.findFirst({
      where: {
        name: input.name
      }
    });
    const update = {
      isActive: true,
      ...(input.monthly_credit_grant !== undefined ? { monthlyCreditAllowance: input.monthly_credit_grant } : {}),
      ...(input.cycle_days !== undefined ? { cycleDays: input.cycle_days } : {}),
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.price_monthly !== undefined ? { priceMonthly: toDecimal(input.price_monthly) } : {})
    };

    if (existing) {
      return tx.billingPlanCatalog.update({
        where: {
          id: existing.id
        },
        data: update
      });
    }

    return tx.billingPlanCatalog.create({
      data: {
        name: input.name,
        monthlyCreditAllowance: input.monthly_credit_grant ?? null,
        cycleDays: input.cycle_days ?? 30,
        currency: input.currency ?? 'INR',
        priceMonthly: toDecimal(input.price_monthly ?? 0),
        isActive: true
      }
    });
  }

  private async applySubscriptionRefill(
    tx: TxClient,
    subscription: {
      id: string;
      tenantId: string;
      accountId: string;
      status: BillingSubscriptionStatusValue;
      startsAt: Date;
      currentPeriodStart: Date | null;
      currentPeriodEnd: Date | null;
      nextRefillAt: Date | null;
      plan: {
        monthlyCreditAllowance: number | null;
        cycleDays: number;
      };
    },
    explicitIdempotencyKey?: string,
    source: 'manual' | 'scheduled' = 'scheduled'
  ) {
    if (subscription.status !== 'active') {
      return {
        duplicate: false,
        status: 'skipped_inactive'
      };
    }

    const periodStart = subscription.currentPeriodStart ?? subscription.startsAt;
    const idempotencyKey =
      explicitIdempotencyKey ?? `refill:${subscription.id}:${periodStart.toISOString().slice(0, 10)}`;

    const existing = await tx.billingSubscriptionEvent.findUnique({
      where: {
        provider_idempotencyKey: {
          provider: 'internal',
          idempotencyKey
        }
      }
    });
    if (existing) {
      return {
        duplicate: true,
        status: 'already_processed'
      };
    }

    const grantAmount = subscription.plan.monthlyCreditAllowance ?? 0;
    if (grantAmount > 0) {
      await this.grantCredits(tx, subscription.accountId, {
        amount: grantAmount,
        reason: 'grant',
        ref_type: 'subscription_refill',
        ref_id: subscription.id,
        idempotency_key: idempotencyKey,
        metadata_json: {
          source
        }
      });
    }

    const nextPeriodStart = subscription.currentPeriodEnd ?? periodStart;
    const nextPeriodEnd = addDaysUtc(nextPeriodStart, subscription.plan.cycleDays || 30);
    const now = new Date();

    await tx.billingSubscription.update({
      where: {
        id: subscription.id
      },
      data: {
        currentPeriodStart: nextPeriodStart,
        currentPeriodEnd: nextPeriodEnd,
        nextRefillAt: nextPeriodEnd,
        lastRefilledAt: now
      }
    });

    await tx.billingSubscriptionEvent.create({
      data: {
        tenantId: subscription.tenantId,
        subscriptionId: subscription.id,
        provider: 'internal',
        eventType: 'credits_refilled',
        payloadJson: asInputJson({
          amount: grantAmount,
          period_start: periodStart.toISOString(),
          period_end: (subscription.currentPeriodEnd ?? nextPeriodStart).toISOString(),
          source
        }),
        idempotencyKey
      }
    });

    return {
      duplicate: false,
      status: 'refilled',
      amount: grantAmount
    };
  }

  private async resolveOrCreateAccountForTenant(
    tx: TxClient,
    tenantId: string,
    accountId?: string,
    externalKey?: string,
    preferredType: AccountType = 'tenant'
  ) {
    if (accountId || externalKey) {
      const existing = await this.getAccountOrNull(tx, { accountId, externalKey });
      if (existing) {
        return existing;
      }
    }

    if (externalKey) {
      this.assertExternalKey(externalKey);
    }
    const key = externalKey ?? (preferredType === 'external_associate' ? `v2:external:${tenantId}` : `v2:tenant:${tenantId}`);
    const created = await tx.billingAccount.upsert({
      where: {
        externalKey: key
      },
      update: {
        tenantId,
        status: 'active'
      },
      create: {
        tenantId,
        accountType: preferredType,
        externalKey: key,
        displayName: preferredType === 'tenant' ? `Tenant ${tenantId}` : `External Associate ${tenantId}`,
        status: 'active',
        defaultPaymentTermsDays: preferredType === 'tenant' ? 15 : 7
      }
    });
    await this.ensureBillingPolicy(tx, created.id, {
      payment_terms_days: created.defaultPaymentTermsDays,
      currency: 'INR',
      is_enabled: true
    });
    await this.ensureCreditBalance(tx, created.id, created.tenantId);
    return created;
  }

  private async getAccountOr404(tx: TxClient, input: { accountId?: string; externalKey?: string }) {
    const row = await this.getAccountOrNull(tx, input);
    if (!row) {
      throw new NotFoundException('billing account not found');
    }
    return row;
  }

  private async getAccountOrNull(tx: TxClient, input: { accountId?: string; externalKey?: string }) {
    if (input.accountId) {
      return tx.billingAccount.findFirst({ where: { id: input.accountId } });
    }
    if (input.externalKey) {
      return tx.billingAccount.findFirst({ where: { externalKey: input.externalKey } });
    }
    return null;
  }

  private assertExternalKey(externalKey: string) {
    if (!isKnownExternalKey(externalKey)) {
      throw new BadRequestException(
        'external_key must match v1:{partner|client|assignment|invoice}:* or v2:{tenant|external}:*'
      );
    }
  }

  private async ensureBillingPolicy(tx: TxClient, accountId: string, input: BillingPolicyUpdateInput) {
    const account = await this.getAccountOr404(tx, { accountId });
    return tx.billingPolicy.upsert({
      where: {
        accountId
      },
      update: {
        billingMode: input.billing_mode ?? undefined,
        paymentTermsDays: input.payment_terms_days ?? undefined,
        currency: input.currency ?? undefined,
        isEnabled: input.is_enabled ?? undefined
      },
      create: {
        tenantId: account.tenantId,
        accountId: account.id,
        billingMode: input.billing_mode ?? 'postpaid',
        paymentTermsDays: input.payment_terms_days ?? account.defaultPaymentTermsDays,
        creditCostModel: 'flat',
        currency: input.currency ?? 'INR',
        isEnabled: input.is_enabled ?? true
      }
    });
  }

  private async aggregateCreditBalances(tx: TxClient, accountId: string) {
    const [walletRows, activeReserved] = await Promise.all([
      tx.billingCreditLedger.aggregate({
        where: {
          accountId,
          reason: {
            in: ['grant', 'topup', 'adjustment', 'consume']
          }
        },
        _sum: {
          delta: true
        }
      }),
      tx.billingCreditReservation.aggregate({
        where: {
          accountId,
          status: 'active'
        },
        _sum: {
          amount: true
        }
      })
    ]);

    const wallet = walletRows._sum.delta ?? 0;
    const reserved = activeReserved._sum.amount ?? 0;
    return {
      wallet,
      reserved,
      available: wallet - reserved
    };
  }

  private async ensureCreditBalance(tx: TxClient, accountId: string, tenantId: string) {
    const existing = await tx.billingCreditBalance.findUnique({
      where: { accountId }
    });
    if (existing) {
      return existing;
    }

    const aggregated = await this.aggregateCreditBalances(tx, accountId);
    return tx.billingCreditBalance.create({
      data: {
        tenantId,
        accountId,
        walletBalance: aggregated.wallet,
        reservedBalance: aggregated.reserved,
        availableBalance: aggregated.available
      }
    });
  }

  private async lockCreditBalance(tx: TxClient, accountId: string, tenantId: string) {
    await this.ensureCreditBalance(tx, accountId, tenantId);
    await tx.$executeRaw`SELECT 1 FROM public.billing_accounts WHERE id = ${accountId}::uuid FOR UPDATE`;
    const rows = await tx.$queryRaw<
      Array<{ walletBalance: number; reservedBalance: number; availableBalance: number }>
    >`SELECT wallet_balance AS "walletBalance", reserved_balance AS "reservedBalance", available_balance AS "availableBalance" FROM public.billing_credit_balances WHERE account_id = ${accountId}::uuid FOR UPDATE`;
    if (!rows[0]) {
      throw new ConflictException('CREDIT_BALANCE_NOT_FOUND');
    }
    return {
      wallet: rows[0].walletBalance,
      reserved: rows[0].reservedBalance,
      available: rows[0].availableBalance
    };
  }

  private async updateCreditBalance(
    tx: TxClient,
    accountId: string,
    next: {
      wallet: number;
      reserved: number;
      available: number;
    }
  ) {
    if (next.wallet < 0 || next.reserved < 0 || next.available < 0 || next.wallet - next.reserved !== next.available) {
      throw new ConflictException('CREDIT_BALANCE_INVARIANT_FAILED');
    }
    await tx.billingCreditBalance.update({
      where: { accountId },
      data: {
        walletBalance: next.wallet,
        reservedBalance: next.reserved,
        availableBalance: next.available
      }
    });
  }

  private async computeCreditBalances(tx: TxClient, accountId: string) {
    const account = await this.getAccountOr404(tx, { accountId });
    const row = await this.ensureCreditBalance(tx, account.id, account.tenantId);
    return {
      wallet: row.walletBalance,
      reserved: row.reservedBalance,
      available: row.availableBalance
    };
  }

  private serializeReservation(row: {
    id: string;
    tenantId: string;
    accountId: string;
    amount: number;
    status: ReservationStatus;
    refType: string;
    refId: string;
    idempotencyKey: string;
    createdAt: Date;
    consumedAt: Date | null;
    releasedAt: Date | null;
  }) {
    return {
      id: row.id,
      tenant_id: row.tenantId,
      account_id: row.accountId,
      amount: row.amount,
      status: row.status.toUpperCase(),
      ref_type: row.refType,
      ref_id: row.refId,
      idempotency_key: row.idempotencyKey,
      created_at: row.createdAt.toISOString(),
      consumed_at: row.consumedAt?.toISOString() ?? null,
      released_at: row.releasedAt?.toISOString() ?? null
    };
  }

  private async getReservationForSettlement(
    tx: TxClient,
    accountId: string,
    reservationId?: string,
    refType?: string,
    refId?: string
  ) {
    const reservation = reservationId
      ? await tx.billingCreditReservation.findFirst({
          where: {
            id: reservationId,
            accountId
          }
        })
      : await tx.billingCreditReservation.findFirst({
          where: {
            accountId,
            ...(refType ? { refType } : {}),
            ...(refId ? { refId } : {})
          },
          orderBy: [{ createdAt: 'desc' }]
        });
    if (!reservation) {
      throw new NotFoundException('reservation not found');
    }
    return reservation;
  }

  private async replaceInvoiceItems(
    tx: TxClient,
    invoiceId: string,
    tenantId: string,
    items: ServiceInvoiceCreateItemInput[],
    assignmentId?: string
  ) {
    await tx.serviceInvoiceItem.deleteMany({
      where: { invoiceId }
    });

    let payload = items;
    if (payload.length === 0 && assignmentId) {
      const assignment = await tx.assignment.findFirst({
        where: { id: assignmentId, tenantId }
      });
      const amount = assignment?.feePaise ? Number(assignment.feePaise.toString()) / 100 : 0;
      if (amount > 0) {
        payload = [
          {
            description: `Valuation fees (${assignment?.title ?? assignmentId})`,
            quantity: 1,
            unit_price: amount,
            order_index: 0
          }
        ];
      }
    }

    for (const [index, item] of payload.entries()) {
      const quantity = item.quantity > 0 ? item.quantity : 1;
      const unitPrice = item.unit_price >= 0 ? item.unit_price : 0;
      await tx.serviceInvoiceItem.create({
        data: {
          tenantId,
          invoiceId,
          description: item.description,
          quantity: new Prisma.Decimal(quantity),
          unitPrice: new Prisma.Decimal(unitPrice),
          lineTotal: new Prisma.Decimal(quantity * unitPrice),
          taxRate: item.tax_rate !== undefined ? new Prisma.Decimal(item.tax_rate) : null,
          taxCode: item.tax_code ?? null,
          serviceCode: item.service_code ?? null,
          orderIndex: item.order_index ?? index
        }
      });
    }
  }

  private async recomputeServiceInvoice(tx: TxClient, invoiceId: string) {
    const invoice = await tx.serviceInvoice.findFirst({
      where: { id: invoiceId },
      include: {
        items: true,
        payments: {
          where: {
            amount: {
              gt: new Prisma.Decimal(0)
            }
          }
        },
        adjustments: true
      }
    });
    if (!invoice) {
      throw new NotFoundException(`invoice ${invoiceId} not found`);
    }

    let subtotal = new Prisma.Decimal(0);
    let tax = new Prisma.Decimal(0);
    for (const item of invoice.items) {
      subtotal = subtotal.plus(item.lineTotal);
      if (item.taxRate) {
        tax = tax.plus(item.lineTotal.mul(item.taxRate).div(100));
      }
    }

    let credited = new Prisma.Decimal(0);
    for (const adjustment of invoice.adjustments) {
      credited = credited.plus(adjustment.amount);
    }

    let paid = new Prisma.Decimal(0);
    for (const payment of invoice.payments) {
      paid = paid.plus(payment.amount);
    }

    const total = subtotal.plus(tax);
    const netPayable = total.minus(credited);
    const due = netPayable.minus(paid);
    const safeDue = due.lessThan(0) ? new Prisma.Decimal(0) : due;

    let status = invoice.status;
    if (status !== 'void' && status !== 'draft') {
      if (safeDue.lessThanOrEqualTo(0)) {
        status = 'paid';
      } else if (paid.greaterThan(0) || credited.greaterThan(0)) {
        status = 'partially_paid';
      } else {
        status = invoice.sentAt ? 'sent' : 'issued';
      }
    }

    return tx.serviceInvoice.update({
      where: { id: invoice.id },
      data: {
        subtotalAmount: subtotal,
        taxAmount: tax,
        totalAmount: total,
        amountPaid: paid,
        amountCredited: credited,
        amountDue: safeDue,
        status,
        isPaid: status === 'paid',
        paidAt: status === 'paid' ? invoice.paidAt ?? new Date() : null
      }
    });
  }

  private async nextInvoiceNumber(tx: TxClient, tenantId: string, accountId: string, issuedDate: Date) {
    const fy = fyForDate(issuedDate);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-seq:${tenantId}:${accountId}:${fy}`}))`;
    const seq = await tx.serviceInvoiceSequence.upsert({
      where: {
        tenantId_accountId_financialYear: {
          tenantId,
          accountId,
          financialYear: fy
        }
      },
      update: {
        lastNumber: {
          increment: 1
        }
      },
      create: {
        tenantId,
        accountId,
        financialYear: fy,
        lastNumber: 1
      }
    });
    return `INV-${issuedDate.getUTCFullYear()}-${String(seq.lastNumber).padStart(5, '0')}`;
  }

  private async addInvoiceAudit(
    tx: TxClient,
    invoiceId: string,
    tenantId: string,
    eventType: string,
    actorUserId: string | null,
    diff: Record<string, unknown>
  ) {
    await tx.serviceInvoiceAuditLog.create({
      data: {
        tenantId,
        invoiceId,
        eventType,
        actorUserId,
        diffJson: diff as Prisma.InputJsonValue
      }
    });
  }

  private serializeInvoiceSummary(row: {
    id: string;
    tenantId: string;
    accountId: string;
    assignmentId: string | null;
    channelRequestId: string | null;
    invoiceNumber: string | null;
    status: ServiceInvoiceStatus;
    issuedDate: Date | null;
    dueDate: Date | null;
    currency: string;
    subtotalAmount: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    amountPaid: Prisma.Decimal;
    amountDue: Prisma.Decimal;
    amountCredited: Prisma.Decimal;
    isPaid: boolean;
    paidAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    account?: { displayName: string } | null;
  }) {
    return {
      id: row.id,
      tenant_id: row.tenantId,
      account_id: row.accountId,
      account_display_name: row.account?.displayName ?? null,
      assignment_id: row.assignmentId,
      channel_request_id: row.channelRequestId,
      invoice_number: row.invoiceNumber,
      status: invoiceStatusOut(row.status),
      issued_date: row.issuedDate?.toISOString().slice(0, 10) ?? null,
      due_date: row.dueDate?.toISOString().slice(0, 10) ?? null,
      currency: row.currency,
      subtotal_amount: decimalToNumber(row.subtotalAmount),
      tax_amount: decimalToNumber(row.taxAmount),
      total_amount: decimalToNumber(row.totalAmount),
      amount_paid: decimalToNumber(row.amountPaid),
      amount_due: decimalToNumber(row.amountDue),
      amount_credited: decimalToNumber(row.amountCredited),
      is_paid: row.isPaid,
      paid_at: row.paidAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  private serializeInvoiceDetail(row: any) {
    return {
      ...this.serializeInvoiceSummary(row),
      notes: row.notes ?? null,
      bill_to_name: row.billToName ?? null,
      bill_to_address: row.billToAddress ?? null,
      sent_at: row.sentAt?.toISOString() ?? null,
      voided_at: row.voidedAt?.toISOString() ?? null,
      void_reason: row.voidReason ?? null,
      items: row.items.map((item: any) => ({
        id: item.id,
        description: item.description,
        quantity: decimalToNumber(item.quantity),
        unit_price: decimalToNumber(item.unitPrice),
        line_total: decimalToNumber(item.lineTotal),
        tax_code: item.taxCode,
        tax_rate: item.taxRate ? decimalToNumber(item.taxRate) : null,
        service_code: item.serviceCode,
        order_index: item.orderIndex
      })),
      payments: row.payments.map((payment: any) => ({
        id: payment.id,
        amount: decimalToNumber(payment.amount),
        paid_at: payment.paidAt.toISOString(),
        mode: payment.mode,
        reference: payment.reference,
        notes: payment.notes
      })),
      adjustments: row.adjustments.map((adjustment: any) => ({
        id: adjustment.id,
        amount: decimalToNumber(adjustment.amount),
        adjustment_type: adjustment.adjustmentType,
        reason: adjustment.reason,
        issued_at: adjustment.issuedAt.toISOString()
      })),
      attachments: row.attachments.map((attachment: any) => ({
        id: attachment.id,
        kind: attachment.kind.toUpperCase(),
        original_name: attachment.originalName,
        storage_key: attachment.storageKey,
        mime_type: attachment.mimeType,
        size_bytes: Number(attachment.sizeBytes),
        created_at: attachment.createdAt.toISOString()
      })),
      audit_logs: row.auditLogs.map((log: any) => ({
        id: log.id,
        event_type: log.eventType,
        actor_user_id: log.actorUserId,
        diff_json: log.diffJson,
        created_at: log.createdAt.toISOString()
      }))
    };
  }

  private serializeUsageEvent(row: {
    id: string;
    sourceSystem: 'v1' | 'v2';
    eventType: string;
    accountId: string | null;
    externalAccountKey: string | null;
    payloadJson: Prisma.JsonValue;
    idempotencyKey: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      source_system: row.sourceSystem.toUpperCase(),
      event_type: row.eventType,
      account_id: row.accountId,
      external_account_key: row.externalAccountKey,
      payload_json: row.payloadJson,
      idempotency_key: row.idempotencyKey,
      created_at: row.createdAt.toISOString()
    };
  }
}
