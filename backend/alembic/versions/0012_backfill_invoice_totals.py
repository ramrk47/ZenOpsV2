"""Backfill invoice totals and balances.

Revision ID: 0012_backfill_invoice_totals
Revises: 0011_invoice_overhaul
Create Date: 2026-02-05
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from alembic import op
from sqlalchemy import text

revision = "0012_backfill_invoice_totals"
down_revision = "0011_invoice_overhaul"
branch_labels = None
depends_on = None

TWOPLACES = Decimal("0.01")


def _q(value: Decimal) -> Decimal:
    return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def upgrade() -> None:
    conn = op.get_bind()

    rows = conn.execute(
        text(
            """
            SELECT id, tax_rate, status, sent_at
            FROM invoices
            """
        )
    ).fetchall()

    if not rows:
        return

    for row in rows:
        invoice_id = row.id

        subtotal = conn.execute(
            text("SELECT COALESCE(SUM(line_total), 0) FROM invoice_items WHERE invoice_id = :id"),
            {"id": invoice_id},
        ).scalar()
        subtotal = _q(Decimal(subtotal or 0))

        any_item_tax = conn.execute(
            text(
                "SELECT 1 FROM invoice_items WHERE invoice_id = :id AND tax_rate IS NOT NULL LIMIT 1"
            ),
            {"id": invoice_id},
        ).first()

        if any_item_tax:
            tax_total = conn.execute(
                text(
                    "SELECT COALESCE(SUM(line_total * tax_rate / 100), 0) FROM invoice_items WHERE invoice_id = :id"
                ),
                {"id": invoice_id},
            ).scalar()
            tax_total = _q(Decimal(tax_total or 0))
        else:
            tax_rate = Decimal(row.tax_rate or 0)
            tax_total = _q(subtotal * tax_rate / Decimal("100.00"))

        total_amount = _q(subtotal + tax_total)

        amount_paid = conn.execute(
            text("SELECT COALESCE(SUM(amount), 0) FROM invoice_payments WHERE invoice_id = :id"),
            {"id": invoice_id},
        ).scalar()
        amount_paid = _q(Decimal(amount_paid or 0))

        amount_credited = conn.execute(
            text("SELECT COALESCE(SUM(amount), 0) FROM invoice_adjustments WHERE invoice_id = :id"),
            {"id": invoice_id},
        ).scalar()
        amount_credited = _q(Decimal(amount_credited or 0))

        amount_due = total_amount - amount_paid - amount_credited
        if amount_due < Decimal("0.00"):
            amount_due = Decimal("0.00")
        amount_due = _q(amount_due)

        status = row.status
        is_paid = False
        paid_at = None

        if status not in ("DRAFT", "VOID"):
            if amount_due <= Decimal("0.00"):
                is_paid = True
                status = "PAID"
                paid_at = conn.execute(
                    text("SELECT MAX(paid_at) FROM invoice_payments WHERE invoice_id = :id"),
                    {"id": invoice_id},
                ).scalar()
            elif amount_paid > Decimal("0.00") or amount_credited > Decimal("0.00"):
                is_paid = False
                status = "PARTIALLY_PAID"
                paid_at = None
            else:
                is_paid = False
                status = "SENT" if row.sent_at else "ISSUED"
                paid_at = None

        conn.execute(
            text(
                """
                UPDATE invoices
                SET subtotal = :subtotal,
                    tax_amount = :tax_amount,
                    total_amount = :total_amount,
                    amount_paid = :amount_paid,
                    amount_credited = :amount_credited,
                    amount_due = :amount_due,
                    is_paid = :is_paid,
                    status = :status,
                    paid_at = :paid_at
                WHERE id = :id
                """
            ),
            {
                "id": invoice_id,
                "subtotal": subtotal,
                "tax_amount": tax_total,
                "total_amount": total_amount,
                "amount_paid": amount_paid,
                "amount_credited": amount_credited,
                "amount_due": amount_due,
                "is_paid": is_paid,
                "status": status,
                "paid_at": paid_at,
            },
        )


def downgrade() -> None:
    # No-op: data backfill only.
    pass
