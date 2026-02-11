import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type TxClient } from '@zenops/db';

export interface InvoicePeriod {
  startDate: string;
  endDate: string;
}

export interface FinalizeBillingResult {
  invoice: {
    id: string;
    tenantId: string;
    periodStart: Date;
    periodEnd: Date;
    status: string;
    currency: string;
    subtotalPaise: bigint;
    taxPaise: bigint;
    totalPaise: bigint;
    issuedAt: Date | null;
    paidAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  usageEvent: {
    id: string;
    unitPricePaise: number;
    amountPaise: bigint;
    units: number;
  };
  invoiceLine: {
    id: string;
    amountPaise: bigint;
    unitPricePaise: number;
    qty: number;
  };
  createdUsageEvent: boolean;
  createdInvoiceLine: boolean;
}

const parseDateOnly = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const toIstBoundary = (value: string): Date => new Date(`${value}T00:00:00+05:30`);

export function getCalendarMonthlyPeriod(now: Date, tz = 'Asia/Kolkata'): InvoicePeriod {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' });
  const parts = fmt.formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;

  if (!year || !month) {
    throw new Error('Unable to resolve calendar month period');
  }

  const startDate = `${year}-${month}-01`;
  const y = Number(year);
  const m = Number(month);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const endDate = `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-01`;

  return { startDate, endDate };
}

export interface MarkInvoicePaidInput {
  amount_paise?: number;
  reference?: string;
  notes?: string;
  actor_user_id?: string | null;
}

@Injectable()
export class BillingService {
  private readonly timezone: string;

  constructor(timezone = 'Asia/Kolkata') {
    this.timezone = timezone;
  }

  async getOrCreateOpenInvoice(tx: TxClient, tenantId: string, now: Date) {
    const period = getCalendarMonthlyPeriod(now, this.timezone);
    const periodStart = parseDateOnly(period.startDate);
    const periodEnd = parseDateOnly(period.endDate);

    const existing = await tx.invoice.findUnique({
      where: {
        tenantId_periodStart_periodEnd: {
          tenantId,
          periodStart,
          periodEnd
        }
      }
    });

    if (existing) {
      return existing;
    }

    const tenantBilling = await this.ensureTenantBilling(tx, tenantId);

    return tx.invoice.create({
      data: {
        tenantId,
        tenantBillingId: tenantBilling.id,
        periodStart,
        periodEnd,
        status: 'open',
        currency: tenantBilling.currency
      }
    });
  }

  async recalcInvoiceTotals(tx: TxClient, invoiceId: string) {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId },
      include: {
        tenantBilling: true
      }
    });

    if (!invoice) {
      throw new NotFoundException(`invoice ${invoiceId} not found`);
    }

    const lineTotals = await tx.invoiceLine.aggregate({
      where: {
        invoiceId
      },
      _sum: {
        amountPaise: true
      }
    });

    const subtotalPaise = lineTotals._sum.amountPaise ?? BigInt(0);
    const taxRateBps = BigInt(invoice.tenantBilling?.taxRateBps ?? 0);
    const taxPaise = (subtotalPaise * taxRateBps) / BigInt(10000);
    const totalPaise = subtotalPaise + taxPaise;

    return tx.invoice.update({
      where: { id: invoiceId },
      data: {
        subtotalPaise,
        taxPaise,
        totalPaise
      }
    });
  }

  async addUsageLineForFinalize(
    tx: TxClient,
    input: {
      tenantId: string;
      reportRequestId: string;
      assignmentId: string | null;
      now: Date;
    }
  ): Promise<FinalizeBillingResult> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:${input.tenantId}`}))`;

    const tenantBilling = await this.ensureTenantBilling(tx, input.tenantId);
    const period = getCalendarMonthlyPeriod(input.now, this.timezone);
    const periodStartTs = toIstBoundary(period.startDate);
    const periodEndTs = toIstBoundary(period.endDate);

    let usageEvent = await tx.usageEvent.findUnique({
      where: {
        reportRequestId_eventType: {
          reportRequestId: input.reportRequestId,
          eventType: 'report_finalized'
        }
      }
    });

    let createdUsageEvent = false;
    if (!usageEvent) {
      const usageCountInPeriod = await tx.usageEvent.count({
        where: {
          tenantId: input.tenantId,
          eventType: 'report_finalized',
          occurredAt: {
            gte: periodStartTs,
            lt: periodEndTs
          }
        }
      });

      const ordinal = usageCountInPeriod + 1;
      const unitPricePaise = ordinal <= tenantBilling.billingPlan.includedReports ? 0 : tenantBilling.billingPlan.unitPricePaise;

      usageEvent = await tx.usageEvent.create({
        data: {
          tenantId: input.tenantId,
          billingPlanId: tenantBilling.billingPlanId,
          reportRequestId: input.reportRequestId,
          assignmentId: input.assignmentId,
          eventType: 'report_finalized',
          units: 1,
          idempotencyKey: `finalize:${input.reportRequestId}`,
          unitPricePaise,
          amountPaise: BigInt(unitPricePaise),
          occurredAt: input.now
        }
      });

      createdUsageEvent = true;
    }

    const invoice = await this.getOrCreateOpenInvoice(tx, input.tenantId, input.now);

    let invoiceLine = await tx.invoiceLine.findUnique({
      where: {
        usageEventId: usageEvent.id
      }
    });
    const hadInvoiceLine = Boolean(invoiceLine);

    if (!invoiceLine) {
      try {
        invoiceLine = await tx.invoiceLine.create({
          data: {
            invoiceId: invoice.id,
            tenantId: input.tenantId,
            lineType: 'usage_report_finalized',
            qty: usageEvent.units,
            unitPricePaise: usageEvent.unitPricePaise,
            amountPaise: usageEvent.amountPaise,
            usageEventId: usageEvent.id,
            reportRequestId: input.reportRequestId
          }
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
          throw error;
        }

        invoiceLine = await tx.invoiceLine.findUnique({
          where: {
            usageEventId: usageEvent.id
          }
        });
      }
    }

    if (!invoiceLine) {
      throw new Error('Failed to resolve invoice line for finalize usage event');
    }

    const updatedInvoice = await this.recalcInvoiceTotals(tx, invoice.id);

    return {
      invoice: updatedInvoice,
      usageEvent: {
        id: usageEvent.id,
        units: usageEvent.units,
        unitPricePaise: usageEvent.unitPricePaise,
        amountPaise: usageEvent.amountPaise
      },
      invoiceLine: {
        id: invoiceLine.id,
        qty: invoiceLine.qty,
        unitPricePaise: invoiceLine.unitPricePaise,
        amountPaise: invoiceLine.amountPaise
      },
      createdUsageEvent,
      createdInvoiceLine: !hadInvoiceLine
    };
  }

  async getBillingMe(tx: TxClient, tenantId: string, now: Date) {
    const tenantBilling = await this.ensureTenantBilling(tx, tenantId);
    const period = getCalendarMonthlyPeriod(now, this.timezone);
    const periodStart = parseDateOnly(period.startDate);
    const periodEnd = parseDateOnly(period.endDate);

    const [invoice, usageCount] = await Promise.all([
      tx.invoice.findUnique({
        where: {
          tenantId_periodStart_periodEnd: {
            tenantId,
            periodStart,
            periodEnd
          }
        }
      }),
      tx.usageEvent.count({
        where: {
          tenantId,
          eventType: 'report_finalized',
          occurredAt: {
            gte: toIstBoundary(period.startDate),
            lt: toIstBoundary(period.endDate)
          }
        }
      })
    ]);

    const includedReports = tenantBilling.billingPlan.includedReports;
    const overageReports = Math.max(usageCount - includedReports, 0);

    return {
      tenant_id: tenantId,
      billing: {
        status: tenantBilling.status,
        billing_email: tenantBilling.billingEmail,
        currency: tenantBilling.currency,
        included_reports: includedReports,
        unit_price_paise: tenantBilling.billingPlan.unitPricePaise,
        tax_rate_bps: tenantBilling.taxRateBps
      },
      current_period: {
        period_start: period.startDate,
        period_end: period.endDate,
        usage_events: usageCount,
        overage_reports: overageReports,
        invoice: invoice
          ? this.serializeInvoice(invoice)
          : {
              status: 'open',
              subtotal_paise: 0,
              tax_paise: 0,
              total_paise: 0
            }
      }
    };
  }

  async listInvoices(tx: TxClient, tenantId: string) {
    const invoices = await tx.invoice.findMany({
      where: {
        tenantId
      },
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }]
    });

    return invoices.map((invoice) => this.serializeInvoice(invoice));
  }

  async getInvoice(tx: TxClient, tenantId: string, invoiceId: string) {
    const invoice = await tx.invoice.findFirst({
      where: {
        id: invoiceId,
        tenantId
      },
      include: {
        lines: {
          orderBy: { createdAt: 'asc' }
        },
        payments: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!invoice) {
      throw new NotFoundException(`invoice ${invoiceId} not found`);
    }

    return {
      ...this.serializeInvoice(invoice),
      lines: invoice.lines.map((line) => ({
        id: line.id,
        line_type: line.lineType,
        qty: line.qty,
        unit_price_paise: line.unitPricePaise,
        amount_paise: Number(line.amountPaise),
        usage_event_id: line.usageEventId,
        report_request_id: line.reportRequestId,
        created_at: line.createdAt.toISOString()
      })),
      payments: invoice.payments.map((payment) => ({
        id: payment.id,
        method: payment.method,
        status: payment.status,
        amount_paise: Number(payment.amountPaise),
        currency: payment.currency,
        reference: payment.reference,
        notes: payment.notes,
        created_at: payment.createdAt.toISOString()
      }))
    };
  }

  async markInvoicePaid(tx: TxClient, tenantId: string, invoiceId: string, input: MarkInvoicePaidInput = {}) {
    const invoice = await tx.invoice.findFirst({
      where: {
        id: invoiceId,
        tenantId
      }
    });

    if (!invoice) {
      throw new NotFoundException(`invoice ${invoiceId} not found`);
    }

    if (invoice.status !== 'paid') {
      const paymentAmount = BigInt(input.amount_paise ?? Number(invoice.totalPaise));

      await tx.payment.create({
        data: {
          tenantId,
          invoiceId,
          createdByUserId: input.actor_user_id ?? null,
          method: 'manual',
          status: 'posted',
          amountPaise: paymentAmount,
          currency: invoice.currency,
          reference: input.reference,
          notes: input.notes
        }
      });

      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          status: 'paid',
          paidAt: new Date(),
          issuedAt: invoice.issuedAt ?? new Date()
        }
      });
    }

    const updated = await this.recalcInvoiceTotals(tx, invoiceId);
    return this.getInvoice(tx, tenantId, updated.id);
  }

  private async ensureTenantBilling(tx: TxClient, tenantId: string) {
    const existing = await tx.tenantBilling.findUnique({
      where: {
        tenantId
      },
      include: {
        billingPlan: true
      }
    });

    if (existing) {
      return existing;
    }

    const billingPlan = await tx.billingPlan.upsert({
      where: {
        tenantId_code: {
          tenantId,
          code: 'launch-default'
        }
      },
      update: {},
      create: {
        tenantId,
        code: 'launch-default',
        name: 'Launch Default',
        currency: 'INR',
        includedReports: 10,
        unitPricePaise: 150000
      }
    });

    return tx.tenantBilling.create({
      data: {
        tenantId,
        billingPlanId: billingPlan.id,
        status: 'active',
        currency: billingPlan.currency,
        taxRateBps: 0
      },
      include: {
        billingPlan: true
      }
    });
  }

  private serializeInvoice(invoice: {
    id: string;
    tenantId: string;
    periodStart: Date;
    periodEnd: Date;
    status: string;
    currency: string;
    subtotalPaise: bigint;
    taxPaise: bigint;
    totalPaise: bigint;
    issuedAt: Date | null;
    paidAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: invoice.id,
      tenant_id: invoice.tenantId,
      period_start: invoice.periodStart.toISOString().slice(0, 10),
      period_end: invoice.periodEnd.toISOString().slice(0, 10),
      status: invoice.status,
      currency: invoice.currency,
      subtotal_paise: Number(invoice.subtotalPaise),
      tax_paise: Number(invoice.taxPaise),
      total_paise: Number(invoice.totalPaise),
      issued_at: invoice.issuedAt?.toISOString() ?? null,
      paid_at: invoice.paidAt?.toISOString() ?? null,
      created_at: invoice.createdAt.toISOString(),
      updated_at: invoice.updatedAt.toISOString()
    };
  }
}
