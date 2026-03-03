from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, List, Optional

from sqlalchemy.orm import Session, selectinload

from app.models.assignment import Assignment
from app.models.enums import AssignmentStatus, InvoiceStatus, NotificationType, PaymentMode, Role
from app.models.invoice import (
    Invoice,
    InvoiceAdjustment,
    InvoiceItem,
    InvoicePayment,
    InvoiceSequence,
    InvoiceTaxBreakdown,
    InvoiceAuditLog,
)
from app.models.master import Branch, CompanyProfile
from app.services.activity import log_activity
from app.services.notifications import notify_roles


TWOPLACES = Decimal("0.01")


def _q(value: Decimal) -> Decimal:
    return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def _line_total(quantity: Decimal, unit_price: Decimal) -> Decimal:
    return _q(quantity * unit_price)


def default_issued_date(issued_date: date | None) -> date:
    return issued_date or datetime.now(timezone.utc).date()


def financial_year_label(issued_date: date) -> str:
    end_year = issued_date.year + 1 if issued_date.month >= 4 else issued_date.year
    return f"FY{end_year % 100:02d}"


def generate_invoice_number(db: Session, *, issued_date: date) -> str:
    financial_year = financial_year_label(issued_date)
    sequence = (
        db.query(InvoiceSequence)
        .filter(InvoiceSequence.financial_year == financial_year)
        .with_for_update()
        .first()
    )
    if not sequence:
        sequence = InvoiceSequence(financial_year=financial_year, last_number=0)
        db.add(sequence)
        db.flush()
    sequence.last_number += 1
    db.add(sequence)
    db.flush()
    return f"Z{financial_year}-{sequence.last_number:05d}"


def replace_invoice_items(db: Session, invoice: Invoice, items_payload: Iterable[dict]) -> List[InvoiceItem]:
    invoice.items.clear()
    db.flush()

    created: List[InvoiceItem] = []
    for idx, item in enumerate(items_payload):
        quantity = Decimal(item.get("quantity", Decimal("1.00")))
        unit_price = Decimal(item.get("unit_price", Decimal("0.00")))
        line_total = _line_total(quantity, unit_price)
        invoice_item = InvoiceItem(
            invoice_id=invoice.id,
            description=str(item["description"]),
            quantity=quantity,
            unit_price=unit_price,
            line_total=line_total,
            order_index=int(item.get("order_index", idx)),
            tax_code=item.get("tax_code"),
            tax_rate=Decimal(item["tax_rate"]) if item.get("tax_rate") is not None else None,
            service_code=item.get("service_code"),
        )
        db.add(invoice_item)
        invoice.items.append(invoice_item)
        created.append(invoice_item)
    db.flush()
    return created


def recompute_invoice_totals(invoice: Invoice) -> Invoice:
    subtotal = sum((item.line_total for item in invoice.items), start=Decimal("0.00"))
    subtotal = _q(subtotal)

    any_item_tax = any(item.tax_rate is not None for item in invoice.items)
    if any_item_tax:
        tax_total = Decimal("0.00")
        for item in invoice.items:
            rate = Decimal(item.tax_rate or Decimal("0.00"))
            tax_total += _q(item.line_total * rate / Decimal("100.00"))
        tax_total = _q(tax_total)
    else:
        tax_rate = Decimal(invoice.tax_rate or Decimal("0.00"))
        tax_total = _q(subtotal * tax_rate / Decimal("100.00"))

    total = _q(subtotal + tax_total)

    invoice.subtotal = subtotal
    invoice.tax_amount = tax_total
    invoice.total_amount = total
    return invoice


def compute_invoice_financials(invoice: Invoice) -> dict[str, Decimal]:
    """Canonical invoice totals used across invoice/detail/analytics views."""
    confirmed_payments = [
        payment
        for payment in invoice.payments
        if str(payment.confirmation_status or "CONFIRMED") == "CONFIRMED"
    ]
    base_total = _q(Decimal(invoice.total_amount or Decimal("0.00")))
    paid_total = _q(sum((payment.amount for payment in confirmed_payments), start=Decimal("0.00")))

    # Adjustments currently represent credits/write-offs that reduce net receivable.
    credited_total = _q(sum((adj.amount for adj in invoice.adjustments), start=Decimal("0.00")))
    adjustments_total = _q(Decimal("0.00") - credited_total)
    net_total = _q(base_total + adjustments_total)
    if net_total < Decimal("0.00"):
        net_total = Decimal("0.00")

    due_total = _q(net_total - paid_total)
    if due_total < Decimal("0.00"):
        due_total = Decimal("0.00")

    return {
        "base_total": base_total,
        "adjustments_total": adjustments_total,
        "net_total": net_total,
        "paid_total": paid_total,
        "due_total": due_total,
        "credited_total": credited_total,
    }


def recompute_invoice_balance(invoice: Invoice) -> Invoice:
    totals = compute_invoice_financials(invoice)

    invoice.amount_paid = totals["paid_total"]
    invoice.amount_credited = totals["credited_total"]
    invoice.amount_due = totals["due_total"]

    if invoice.status not in {InvoiceStatus.DRAFT, InvoiceStatus.VOID}:
        if invoice.amount_due <= Decimal("0.00"):
            invoice.is_paid = True
            invoice.status = InvoiceStatus.PAID
            confirmed_payments = [
                payment
                for payment in invoice.payments
                if str(payment.confirmation_status or "CONFIRMED") == "CONFIRMED"
            ]
            if confirmed_payments:
                invoice.paid_at = max(p.paid_at for p in confirmed_payments)
        elif invoice.amount_paid > Decimal("0.00") or invoice.amount_credited > Decimal("0.00"):
            invoice.is_paid = False
            invoice.status = InvoiceStatus.PARTIALLY_PAID
            invoice.paid_at = None
        else:
            invoice.is_paid = False
            invoice.status = InvoiceStatus.SENT if invoice.sent_at else InvoiceStatus.ISSUED
            invoice.paid_at = None

    return invoice


def backfill_invoice_totals(db: Session, *, batch_size: int = 200) -> int:
    invoices = (
        db.query(Invoice)
        .options(
            selectinload(Invoice.items),
            selectinload(Invoice.payments),
            selectinload(Invoice.adjustments),
        )
        .yield_per(batch_size)
        .all()
    )
    updated = 0
    for invoice in invoices:
        recompute_invoice_totals(invoice)
        recompute_invoice_balance(invoice)
        db.add(invoice)
        updated += 1
    db.commit()
    return updated


def derive_party_name(invoice: Invoice, assignment: Assignment | None) -> str:
    if invoice.bill_to_name:
        return invoice.bill_to_name
    if assignment:
        return (
            assignment.borrower_name
            or assignment.valuer_client_name
            or assignment.bank_name
            or assignment.assignment_code
            or "—"
        )
    return "—"


def ensure_invoice_snapshot(invoice: Invoice, assignment: Assignment) -> None:
    if not invoice.bill_to_name:
        invoice.bill_to_name = (
            assignment.borrower_name or assignment.valuer_client_name or assignment.bank_name
        )
    if not invoice.bill_to_address:
        invoice.bill_to_address = assignment.address
    if invoice.bank_id is None:
        invoice.bank_id = assignment.bank_id
    if invoice.branch_id is None:
        invoice.branch_id = assignment.branch_id
    if invoice.client_id is None:
        invoice.client_id = assignment.client_id
    if invoice.partner_id is None and getattr(assignment, "partner_id", None):
        invoice.partner_id = assignment.partner_id


def infer_place_of_supply(invoice: Invoice, assignment: Assignment, branch: Branch | None) -> str | None:
    if invoice.place_of_supply:
        return invoice.place_of_supply
    if branch and branch.state:
        return branch.state
    return None


def compute_tax_breakdown(
    *,
    invoice: Invoice,
    assignment: Assignment | None,
    profile: CompanyProfile,
    branch: Branch | None = None,
) -> InvoiceTaxBreakdown:
    taxable = Decimal(invoice.subtotal or Decimal("0.00"))
    tax_total = Decimal(invoice.tax_amount or Decimal("0.00"))
    place_of_supply = None
    if assignment and branch:
        place_of_supply = infer_place_of_supply(invoice, assignment, branch)
    if not place_of_supply and invoice.place_of_supply:
        place_of_supply = invoice.place_of_supply

    cgst = Decimal("0.00")
    sgst = Decimal("0.00")
    igst = Decimal("0.00")
    cess = Decimal("0.00")

    if place_of_supply and profile.state_code:
        if place_of_supply.strip().lower() in {
            profile.state_code.strip().lower(),
            (profile.state_name or "").strip().lower(),
        }:
            cgst = _q(tax_total / Decimal("2.00"))
            sgst = _q(tax_total - cgst)
        else:
            igst = _q(tax_total)
    else:
        igst = _q(tax_total)

    return InvoiceTaxBreakdown(
        invoice_id=invoice.id,
        taxable_value=_q(taxable),
        cgst=cgst,
        sgst=sgst,
        igst=igst,
        cess=cess,
    )


def snapshot_tax_breakdown(
    db: Session,
    *,
    invoice: Invoice,
    assignment: Assignment | None,
    profile: CompanyProfile,
    branch: Branch | None,
) -> InvoiceTaxBreakdown:
    breakdown = compute_tax_breakdown(
        invoice=invoice,
        assignment=assignment,
        profile=profile,
        branch=branch,
    )
    db.add(breakdown)
    db.flush()
    return breakdown


def add_invoice_audit_log(
    db: Session,
    *,
    invoice_id: int,
    event_type: str,
    actor_user_id: Optional[int],
    diff: Optional[dict] = None,
) -> InvoiceAuditLog:
    entry = InvoiceAuditLog(
        invoice_id=invoice_id,
        event_type=event_type,
        actor_user_id=actor_user_id,
        diff_json=diff,
    )
    db.add(entry)
    db.flush()
    return entry


def mark_invoice_paid(db: Session, *, invoice: Invoice, actor_user_id: int) -> Invoice:
    amount_due = Decimal(invoice.amount_due or Decimal("0.00"))
    payment = InvoicePayment(
        invoice_id=invoice.id,
        amount=amount_due,
        paid_at=datetime.now(timezone.utc),
        mode=PaymentMode.OTHER,
        created_by_user_id=actor_user_id,
        confirmation_status="CONFIRMED",
        confirmed_by_user_id=actor_user_id,
        confirmed_at=datetime.now(timezone.utc),
        notes="Marked paid",
    )
    db.add(payment)
    invoice.payments.append(payment)
    recompute_invoice_balance(invoice)
    db.add(invoice)

    assignment = invoice.assignment
    if assignment:
        assignment.is_paid = invoice.is_paid
        if assignment.status != AssignmentStatus.COMPLETED:
            assignment.updated_at = datetime.now(timezone.utc)
        db.add(assignment)

        log_activity(
            db,
            actor_user_id=actor_user_id,
            activity_type="INVOICE_MARKED_PAID",
            assignment_id=assignment.id,
            message=f"Invoice {invoice.invoice_number or invoice.id} marked as paid",
            payload={"invoice_id": invoice.id, "invoice_number": invoice.invoice_number},
        )

        notify_roles(
            db,
            roles=[Role.ADMIN, Role.OPS_MANAGER, Role.FINANCE],
            notif_type=NotificationType.PAYMENT_PENDING,
            message=f"Invoice paid: {invoice.invoice_number or invoice.id}",
            payload={"invoice_id": invoice.id, "assignment_id": assignment.id},
            exclude_user_ids=[actor_user_id],
        )
    db.flush()
    return invoice
