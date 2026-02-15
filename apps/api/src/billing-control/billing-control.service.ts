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

export interface BillingAccountCreateInput {
  tenant_id: string;
  account_type: AccountType;
  display_name: string;
  external_key: string;
  payment_terms_days?: number;
}

export interface BillingPolicyUpdateInput {
  billing_mode: BillingMode;
  payment_terms_days?: number;
  currency?: string;
  is_enabled?: boolean;
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
      billing_mode: 'postpaid',
      payment_terms_days: terms,
      currency: 'INR',
      is_enabled: true
    });

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
      billing_mode: 'postpaid',
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

  async setBillingPolicy(tx: TxClient, accountId: string, input: BillingPolicyUpdateInput) {
    const account = await this.getAccountOr404(tx, { accountId });
    const policy = await this.ensureBillingPolicy(tx, account.id, input);
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
      billing_mode: 'postpaid',
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

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`credit-reserve:${account.id}`}))`;
    const credit = await this.computeCreditBalances(tx, account.id);
    if (credit.available < amount) {
      throw new ConflictException('INSUFFICIENT_CREDITS');
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

    const reservation = await this.getReservationForSettlement(tx, account.id, input.reservation_id, input.ref_type, input.ref_id);
    if (reservation.status !== 'active') {
      return reservation;
    }

    await tx.billingCreditReservation.update({
      where: { id: reservation.id },
      data: {
        status: 'consumed',
        consumedAt: new Date()
      }
    });

    return tx.billingCreditLedger.create({
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

    const reservation = await this.getReservationForSettlement(tx, account.id, input.reservation_id, input.ref_type, input.ref_id);
    if (reservation.status !== 'active') {
      return reservation;
    }

    await tx.billingCreditReservation.update({
      where: { id: reservation.id },
      data: {
        status: 'released',
        releasedAt: new Date()
      }
    });

    return tx.billingCreditLedger.create({
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

  async listSubscriptions(tx: TxClient) {
    const rows = await tx.billingSubscription.findMany({
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
      monthly_credit_allowance: row.plan.monthlyCreditAllowance,
      status: row.status.toUpperCase(),
      starts_at: row.startsAt.toISOString(),
      ends_at: row.endsAt?.toISOString() ?? null
    }));
  }

  async assignSubscription(tx: TxClient, input: { account_id: string; plan_name: string; monthly_credit_allowance?: number; status?: 'active' | 'past_due' | 'cancelled' }) {
    const account = await this.getAccountOr404(tx, { accountId: input.account_id });
    const existingPlan = await tx.billingPlanCatalog.findFirst({
      where: {
        name: input.plan_name
      }
    });
    const plan = existingPlan
      ? await tx.billingPlanCatalog.update({
          where: {
            id: existingPlan.id
          },
          data: {
            monthlyCreditAllowance: input.monthly_credit_allowance ?? null,
            isActive: true
          }
        })
      : await tx.billingPlanCatalog.create({
          data: {
            name: input.plan_name,
            monthlyCreditAllowance: input.monthly_credit_allowance ?? null,
            isActive: true
          }
        });

    const created = await tx.billingSubscription.create({
      data: {
        tenantId: account.tenantId,
        accountId: account.id,
        planId: plan.id,
        status: input.status ?? 'active'
      }
    });

    return {
      id: created.id,
      account_id: created.accountId,
      plan_id: created.planId,
      status: created.status.toUpperCase()
    };
  }

  async listServiceInvoices(tx: TxClient, tenantId: string) {
    const rows = await tx.serviceInvoice.findMany({
      where: { tenantId },
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
      billing_mode: 'postpaid',
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

  async issueServiceInvoice(tx: TxClient, tenantId: string, invoiceId: string, actorUserId: string | null, issuedDate?: string, dueDate?: string) {
    const row = await tx.serviceInvoice.findFirst({
      where: { id: invoiceId, tenantId }
    });
    if (!row) {
      throw new NotFoundException(`invoice ${invoiceId} not found`);
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
    return this.getServiceInvoice(tx, tenantId, row.id);
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

  async addServiceInvoicePayment(tx: TxClient, tenantId: string, invoiceId: string, actorUserId: string | null, input: ServiceInvoicePaymentInput) {
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

    await tx.serviceInvoicePayment.create({
      data: {
        tenantId,
        invoiceId: row.id,
        amount: new Prisma.Decimal(input.amount),
        mode: input.mode ?? 'manual',
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
      idempotency_key: `v2:payment:${row.id}:${Date.now()}`
    });
    return this.getServiceInvoice(tx, tenantId, row.id);
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
    const externalKey = `portal_user:${input.requested_by_user_id}`;
    const account = await this.resolveOrCreateAccountForTenant(tx, input.tenant_id, undefined, externalKey, 'external_associate');
    const policy = await this.ensureBillingPolicy(tx, account.id, {
      billing_mode: 'postpaid',
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

    const key = externalKey ?? `tenant:${tenantId}`;
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
      billing_mode: 'postpaid',
      payment_terms_days: created.defaultPaymentTermsDays,
      currency: 'INR',
      is_enabled: true
    });
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

  private async ensureBillingPolicy(tx: TxClient, accountId: string, input: BillingPolicyUpdateInput) {
    const account = await this.getAccountOr404(tx, { accountId });
    return tx.billingPolicy.upsert({
      where: {
        accountId
      },
      update: {
        billingMode: input.billing_mode,
        paymentTermsDays: input.payment_terms_days ?? undefined,
        currency: input.currency ?? undefined,
        isEnabled: input.is_enabled ?? undefined
      },
      create: {
        tenantId: account.tenantId,
        accountId: account.id,
        billingMode: input.billing_mode,
        paymentTermsDays: input.payment_terms_days ?? account.defaultPaymentTermsDays,
        creditCostModel: 'flat',
        currency: input.currency ?? 'INR',
        isEnabled: input.is_enabled ?? true
      }
    });
  }

  private async computeCreditBalances(tx: TxClient, accountId: string) {
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

  private serializeReservation(row: {
    id: string;
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
    return `ZFY${fy.replace('-', '')}-${String(seq.lastNumber).padStart(5, '0')}`;
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
