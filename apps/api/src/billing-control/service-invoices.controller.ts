import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query
} from '@nestjs/common';
import type { JwtClaims } from '@zenops/auth';
import { z } from 'zod';
import { Claims } from '../auth/claims.decorator.js';
import { Capabilities } from '../auth/rbac.js';
import { RequestContextService } from '../db/request-context.service.js';
import { BillingControlService, type ServiceInvoiceAdjustmentInput, type ServiceInvoiceCreateInput, type ServiceInvoicePaymentInput, type ServiceInvoiceUpdateInput } from './billing-control.service.js';

const ServiceInvoiceCreateSchema = z.object({
  account_id: z.string().uuid().optional(),
  external_key: z.string().min(1).optional(),
  assignment_id: z.string().uuid().optional(),
  channel_request_id: z.string().uuid().optional(),
  issued_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currency: z.string().min(1).optional(),
  notes: z.string().optional(),
  bill_to_name: z.string().optional(),
  bill_to_address: z.string().optional(),
  items: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.number().positive(),
        unit_price: z.number().nonnegative(),
        tax_rate: z.number().nonnegative().optional(),
        tax_code: z.string().optional(),
        service_code: z.string().optional(),
        order_index: z.number().int().nonnegative().optional()
      })
    )
    .optional()
});

const ServiceInvoiceUpdateSchema = z.object({
  notes: z.string().optional(),
  bill_to_name: z.string().optional(),
  bill_to_address: z.string().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  items: ServiceInvoiceCreateSchema.shape.items
});

const ServiceInvoiceIssueSchema = z.object({
  issued_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

const ServiceInvoiceVoidSchema = z.object({
  reason: z.string().min(1)
});

const ServiceInvoicePaymentSchema = z.object({
  amount: z.number().positive(),
  mode: z.string().optional(),
  reference: z.string().optional(),
  notes: z.string().optional()
});

const ServiceInvoiceAdjustmentSchema = z.object({
  amount: z.number().positive(),
  adjustment_type: z.string().optional(),
  reason: z.string().optional()
});

const ServiceInvoiceAttachmentSchema = z.object({
  kind: z.enum(['invoice_document', 'payment_proof', 'other']),
  original_name: z.string().min(1),
  storage_key: z.string().min(1),
  mime_type: z.string().optional(),
  size_bytes: z.number().int().nonnegative().optional()
});

const parseOrThrow = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.flatten());
  }
  return parsed.data;
};

@Controller(['invoices', 'service-invoices'])
export class ServiceInvoicesController {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly billingControlService: BillingControlService
  ) {}

  private assertCanRead(claims: JwtClaims): void {
    if (claims.roles.includes('super_admin') || claims.capabilities.includes('*')) {
      return;
    }
    if (claims.aud === 'portal') {
      return;
    }
    if (!claims.capabilities.includes(Capabilities.invoicesRead) && !claims.capabilities.includes(Capabilities.invoicesWrite)) {
      throw new ForbiddenException('INVOICE_READ_FORBIDDEN');
    }
  }

  private assertCanWrite(claims: JwtClaims): void {
    if (claims.roles.includes('super_admin') || claims.capabilities.includes('*')) {
      return;
    }
    if (claims.aud === 'portal') {
      throw new ForbiddenException('PORTAL_INVOICE_WRITE_FORBIDDEN');
    }
    if (!claims.capabilities.includes(Capabilities.invoicesWrite) && !claims.capabilities.includes('billing:write')) {
      throw new ForbiddenException('INVOICE_WRITE_FORBIDDEN');
    }
  }

  @Get()
  async listInvoices(@Claims() claims: JwtClaims, @Query('account_id') accountId?: string) {
    this.assertCanRead(claims);
    const tenantId = this.requestContext.tenantIdForClaims(claims);
    if (!tenantId) {
      throw new ForbiddenException('TENANT_CONTEXT_REQUIRED');
    }
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.billingControlService.listServiceInvoices(tx, tenantId, accountId)
    );
  }

  @Post()
  async createInvoice(@Claims() claims: JwtClaims, @Body() body: unknown) {
    this.assertCanWrite(claims);
    const tenantId = this.requestContext.tenantIdForClaims(claims);
    if (!tenantId) {
      throw new ForbiddenException('TENANT_CONTEXT_REQUIRED');
    }
    const input = parseOrThrow<ServiceInvoiceCreateInput>(ServiceInvoiceCreateSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.billingControlService.createServiceInvoice(tx, tenantId, claims.user_id ?? null, input)
    );
  }

  @Get(':id')
  async getInvoice(@Claims() claims: JwtClaims, @Param('id') id: string) {
    this.assertCanRead(claims);
    const tenantId = this.requestContext.tenantIdForClaims(claims);
    if (!tenantId) {
      throw new ForbiddenException('TENANT_CONTEXT_REQUIRED');
    }
    return this.requestContext.runWithClaims(claims, (tx) => this.billingControlService.getServiceInvoice(tx, tenantId, id));
  }

  @Patch(':id')
  async updateInvoice(@Claims() claims: JwtClaims, @Param('id') id: string, @Body() body: unknown) {
    this.assertCanWrite(claims);
    const tenantId = this.requestContext.tenantIdForClaims(claims);
    if (!tenantId) {
      throw new ForbiddenException('TENANT_CONTEXT_REQUIRED');
    }
    const input = parseOrThrow<ServiceInvoiceUpdateInput>(ServiceInvoiceUpdateSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.billingControlService.updateServiceInvoice(tx, tenantId, id, claims.user_id ?? null, input)
    );
  }

  @Post(':id/issue')
  async issueInvoice(
    @Claims() claims: JwtClaims,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    this.assertCanWrite(claims);
    const tenantId = this.requestContext.tenantIdForClaims(claims);
    if (!tenantId) {
      throw new ForbiddenException('TENANT_CONTEXT_REQUIRED');
    }
    const input = parseOrThrow<{ issued_date?: string; due_date?: string }>(ServiceInvoiceIssueSchema, body ?? {});
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.billingControlService.issueServiceInvoice(
        tx,
        tenantId,
        id,
        claims.user_id ?? null,
        input.issued_date,
        input.due_date,
        idempotencyKey ?? null
      )
    );
  }

  @Post(':id/send')
  async sendInvoice(@Claims() claims: JwtClaims, @Param('id') id: string) {
    this.assertCanWrite(claims);
    const tenantId = this.requestContext.tenantIdForClaims(claims);
    if (!tenantId) {
      throw new ForbiddenException('TENANT_CONTEXT_REQUIRED');
    }
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.billingControlService.sendServiceInvoice(tx, tenantId, id, claims.user_id ?? null)
    );
  }

  @Post(':id/void')
  async voidInvoice(@Claims() claims: JwtClaims, @Param('id') id: string, @Body() body: unknown) {
    this.assertCanWrite(claims);
    const tenantId = this.requestContext.tenantIdForClaims(claims);
    if (!tenantId) {
      throw new ForbiddenException('TENANT_CONTEXT_REQUIRED');
    }
    const input = parseOrThrow<{ reason: string }>(ServiceInvoiceVoidSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.billingControlService.voidServiceInvoice(tx, tenantId, id, claims.user_id ?? null, input.reason)
    );
  }

  @Post(':id/payments')
  async addPayment(
    @Claims() claims: JwtClaims,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    this.assertCanWrite(claims);
    const tenantId = this.requestContext.tenantIdForClaims(claims);
    if (!tenantId) {
      throw new ForbiddenException('TENANT_CONTEXT_REQUIRED');
    }
    const input = parseOrThrow<ServiceInvoicePaymentInput>(ServiceInvoicePaymentSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.billingControlService.addServiceInvoicePayment(tx, tenantId, id, claims.user_id ?? null, input, idempotencyKey ?? null)
    );
  }

  @Post(':id/mark-paid')
  async markPaid(
    @Claims() claims: JwtClaims,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    this.assertCanWrite(claims);
    const tenantId = this.requestContext.tenantIdForClaims(claims);
    if (!tenantId) {
      throw new ForbiddenException('TENANT_CONTEXT_REQUIRED');
    }
    const input = parseOrThrow<{
      amount?: number;
      mode?: string;
      reference?: string;
      notes?: string;
    }>(
      z.object({
        amount: z.number().positive().optional(),
        mode: z.string().optional(),
        reference: z.string().optional(),
        notes: z.string().optional()
      }),
      body ?? {}
    );

    return this.requestContext.runWithClaims(claims, async (tx) => {
      const invoice = await this.billingControlService.getServiceInvoice(tx, tenantId, id);
      const amount = input.amount ?? invoice.amount_due;
      const markPaidIdempotencyKey = idempotencyKey ?? `invoice_mark_paid:${id}`;
      return this.billingControlService.addServiceInvoicePayment(tx, tenantId, id, claims.user_id ?? null, {
        amount,
        mode: input.mode ?? 'manual',
        reference: input.reference,
        notes: input.notes
      }, markPaidIdempotencyKey);
    });
  }

  @Post(':id/adjustments')
  async addAdjustment(@Claims() claims: JwtClaims, @Param('id') id: string, @Body() body: unknown) {
    this.assertCanWrite(claims);
    const tenantId = this.requestContext.tenantIdForClaims(claims);
    if (!tenantId) {
      throw new ForbiddenException('TENANT_CONTEXT_REQUIRED');
    }
    const input = parseOrThrow<ServiceInvoiceAdjustmentInput>(ServiceInvoiceAdjustmentSchema, body);
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.billingControlService.addServiceInvoiceAdjustment(tx, tenantId, id, claims.user_id ?? null, input)
    );
  }

  @Post(':id/remind')
  async remindInvoice(
    @Claims() claims: JwtClaims,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined
  ) {
    this.assertCanWrite(claims);
    const tenantId = this.requestContext.tenantIdForClaims(claims);
    if (!tenantId) {
      throw new ForbiddenException('TENANT_CONTEXT_REQUIRED');
    }
    return this.requestContext.runWithClaims(claims, async (tx) => {
      const invoice = await this.billingControlService.getServiceInvoice(tx, tenantId, id);
      return this.billingControlService.remindServiceInvoice(
        tx,
        tenantId,
        id,
        invoice.account_id,
        idempotencyKey ?? null
      );
    });
  }

  @Get(':id/context')
  async invoiceContext(@Claims() claims: JwtClaims, @Param('id') id: string) {
    this.assertCanRead(claims);
    const tenantId = this.requestContext.tenantIdForClaims(claims);
    if (!tenantId) {
      throw new ForbiddenException('TENANT_CONTEXT_REQUIRED');
    }
    return this.requestContext.runWithClaims(claims, (tx) => this.billingControlService.getServiceInvoiceContext(tx, tenantId, id));
  }

  @Get(':id/pdf')
  async invoicePdf(@Claims() claims: JwtClaims, @Param('id') id: string) {
    this.assertCanRead(claims);
    return {
      status: 'stub',
      invoice_id: id,
      message: 'PDF export endpoint reserved; wire renderer in a later milestone'
    };
  }

  @Post(':id/payment-proof')
  async uploadPaymentProof(@Claims() claims: JwtClaims, @Param('id') id: string, @Body() body: unknown) {
    this.assertCanRead(claims);
    const tenantId = this.requestContext.tenantIdForClaims(claims);
    if (!tenantId) {
      throw new ForbiddenException('TENANT_CONTEXT_REQUIRED');
    }
    const input = parseOrThrow<{ kind: 'invoice_document' | 'payment_proof' | 'other'; original_name: string; storage_key: string; mime_type?: string; size_bytes?: number }>(
      ServiceInvoiceAttachmentSchema,
      body
    );
    return this.requestContext.runWithClaims(claims, (tx) =>
      this.billingControlService.addServiceInvoiceAttachment(tx, tenantId, id, claims.user_id ?? null, input)
    );
  }
}
