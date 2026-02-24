"""Invoice overhaul: payments, adjustments, audit logs, canonical totals.

Revision ID: 0011_invoice_overhaul
Revises: 0010_add_user_capability_overrides
Create Date: 2026-02-05
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0011_invoice_overhaul"
down_revision = "0010_add_user_capability_overrides"
branch_labels = None
depends_on = None


def _is_sqlite() -> bool:
    return op.get_bind().dialect.name == "sqlite"


def upgrade() -> None:
    if not _is_sqlite():
        op.execute("ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'SENT'")
        op.execute("ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'PARTIALLY_PAID'")

    op.add_column("invoices", sa.Column("currency", sa.String(length=3), nullable=False, server_default="INR"))
    op.add_column("invoices", sa.Column("amount_paid", sa.Numeric(12, 2), nullable=False, server_default="0"))
    op.add_column("invoices", sa.Column("amount_due", sa.Numeric(12, 2), nullable=False, server_default="0"))
    op.add_column("invoices", sa.Column("amount_credited", sa.Numeric(12, 2), nullable=False, server_default="0"))
    op.add_column("invoices", sa.Column("bill_to_name", sa.String(length=255), nullable=True))
    op.add_column("invoices", sa.Column("bill_to_address", sa.Text(), nullable=True))
    op.add_column("invoices", sa.Column("bill_to_gstin", sa.String(length=50), nullable=True))
    op.add_column("invoices", sa.Column("place_of_supply", sa.String(length=100), nullable=True))
    op.add_column("invoices", sa.Column("terms", sa.Text(), nullable=True))
    op.add_column("invoices", sa.Column("bank_id", sa.Integer(), nullable=True))
    op.add_column("invoices", sa.Column("branch_id", sa.Integer(), nullable=True))
    op.add_column("invoices", sa.Column("client_id", sa.Integer(), nullable=True))
    op.add_column("invoices", sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("invoices", sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("invoices", sa.Column("void_reason", sa.Text(), nullable=True))
    op.add_column("invoices", sa.Column("voided_by_user_id", sa.Integer(), nullable=True))

    op.create_index("ix_invoices_amount_due", "invoices", ["amount_due"], unique=False)
    op.create_index("ix_invoices_bank_id", "invoices", ["bank_id"], unique=False)
    op.create_index("ix_invoices_branch_id", "invoices", ["branch_id"], unique=False)
    op.create_index("ix_invoices_client_id", "invoices", ["client_id"], unique=False)
    op.create_index("ix_invoices_voided_by_user_id", "invoices", ["voided_by_user_id"], unique=False)

    op.create_foreign_key(
        "fk_invoices_bank_id_banks",
        "invoices",
        "banks",
        ["bank_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_invoices_branch_id_branches",
        "invoices",
        "branches",
        ["branch_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_invoices_client_id_clients",
        "invoices",
        "clients",
        ["client_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_invoices_voided_by_user_id_users",
        "invoices",
        "users",
        ["voided_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.alter_column("invoices", "invoice_number", nullable=True)

    op.add_column("invoice_items", sa.Column("tax_code", sa.String(length=50), nullable=True))
    op.add_column("invoice_items", sa.Column("tax_rate", sa.Numeric(5, 2), nullable=True))
    op.add_column("invoice_items", sa.Column("service_code", sa.String(length=50), nullable=True))

    if _is_sqlite():
        payment_mode = sa.String(length=20)
        adjustment_type = sa.String(length=30)
    else:
        payment_mode = postgresql.ENUM(
            "CASH",
            "BANK_TRANSFER",
            "UPI",
            "CHEQUE",
            "CARD",
            "MANUAL",
            "OTHER",
            name="payment_mode",
            create_type=False,
        )
        adjustment_type = postgresql.ENUM(
            "CREDIT_NOTE",
            "DISCOUNT",
            "WRITE_OFF",
            "OTHER",
            name="invoice_adjustment_type",
            create_type=False,
        )
        payment_mode.create(op.get_bind(), checkfirst=True)
        adjustment_type.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "invoice_payments",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("mode", payment_mode, nullable=False, server_default="MANUAL"),
        sa.Column("reference_no", sa.String(length=100), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
    )
    op.create_index("ix_invoice_payments_invoice_id", "invoice_payments", ["invoice_id"], unique=False)

    op.create_table(
        "invoice_adjustments",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("adjustment_type", adjustment_type, nullable=False, server_default="CREDIT_NOTE"),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
    )
    op.create_index("ix_invoice_adjustments_invoice_id", "invoice_adjustments", ["invoice_id"], unique=False)

    op.create_table(
        "invoice_tax_breakdowns",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("taxable_value", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("cgst", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("sgst", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("igst", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("cess", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_invoice_tax_breakdowns_invoice_id", "invoice_tax_breakdowns", ["invoice_id"], unique=False)

    op.create_table(
        "invoice_audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("diff_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"]),
    )
    op.create_index("ix_invoice_audit_logs_invoice_id", "invoice_audit_logs", ["invoice_id"], unique=False)
    op.create_index("ix_invoice_audit_logs_event_type", "invoice_audit_logs", ["event_type"], unique=False)

    op.create_table(
        "invoice_attachments",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("uploaded_by_user_id", sa.Integer(), nullable=False),
        sa.Column("original_name", sa.String(length=255), nullable=False),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("mime_type", sa.String(length=255), nullable=True),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["users.id"]),
        sa.UniqueConstraint("storage_path", name="uq_invoice_attachments_storage_path"),
    )
    op.create_index("ix_invoice_attachments_invoice_id", "invoice_attachments", ["invoice_id"], unique=False)

    op.create_table(
        "invoice_sequences",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("financial_year", sa.String(length=10), nullable=False),
        sa.Column("last_number", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("financial_year", name="uq_invoice_sequences_financial_year"),
    )
    op.create_index("ix_invoice_sequences_financial_year", "invoice_sequences", ["financial_year"], unique=False)

    op.execute("UPDATE invoices SET currency = 'INR' WHERE currency IS NULL")

    if _is_sqlite():
        op.execute(
            "UPDATE invoices SET amount_paid = CASE WHEN is_paid = 1 THEN total_amount ELSE 0 END, "
            "amount_due = CASE WHEN is_paid = 1 THEN 0 ELSE total_amount END"
        )
        op.execute(
            "UPDATE invoices SET bank_id = (SELECT bank_id FROM assignments WHERE assignments.id = invoices.assignment_id)"
        )
        op.execute(
            "UPDATE invoices SET branch_id = (SELECT branch_id FROM assignments WHERE assignments.id = invoices.assignment_id)"
        )
        op.execute(
            "UPDATE invoices SET client_id = (SELECT client_id FROM assignments WHERE assignments.id = invoices.assignment_id)"
        )
        op.execute(
            "UPDATE invoices SET bill_to_name = (SELECT COALESCE(borrower_name, valuer_client_name, bank_name) "
            "FROM assignments WHERE assignments.id = invoices.assignment_id) "
            "WHERE bill_to_name IS NULL"
        )
        op.execute(
            "UPDATE invoices SET bill_to_address = (SELECT address FROM assignments WHERE assignments.id = invoices.assignment_id) "
            "WHERE bill_to_address IS NULL"
        )
    else:
        op.execute(
            "UPDATE invoices SET amount_paid = CASE WHEN is_paid THEN total_amount ELSE 0 END, "
            "amount_due = CASE WHEN is_paid THEN 0 ELSE total_amount END"
        )
        op.execute(
            "UPDATE invoices SET "
            "bank_id = assignments.bank_id, "
            "branch_id = assignments.branch_id, "
            "client_id = assignments.client_id, "
            "bill_to_name = COALESCE(invoices.bill_to_name, assignments.borrower_name, assignments.valuer_client_name, assignments.bank_name), "
            "bill_to_address = COALESCE(invoices.bill_to_address, assignments.address) "
            "FROM assignments WHERE invoices.assignment_id = assignments.id"
        )

    op.alter_column("invoices", "currency", server_default=None)
    op.alter_column("invoices", "amount_paid", server_default=None)
    op.alter_column("invoices", "amount_due", server_default=None)
    op.alter_column("invoices", "amount_credited", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_invoice_sequences_financial_year", table_name="invoice_sequences")
    op.drop_table("invoice_sequences")

    op.drop_index("ix_invoice_attachments_invoice_id", table_name="invoice_attachments")
    op.drop_table("invoice_attachments")

    op.drop_index("ix_invoice_audit_logs_event_type", table_name="invoice_audit_logs")
    op.drop_index("ix_invoice_audit_logs_invoice_id", table_name="invoice_audit_logs")
    op.drop_table("invoice_audit_logs")

    op.drop_index("ix_invoice_tax_breakdowns_invoice_id", table_name="invoice_tax_breakdowns")
    op.drop_table("invoice_tax_breakdowns")

    op.drop_index("ix_invoice_adjustments_invoice_id", table_name="invoice_adjustments")
    op.drop_table("invoice_adjustments")

    op.drop_index("ix_invoice_payments_invoice_id", table_name="invoice_payments")
    op.drop_table("invoice_payments")

    op.drop_column("invoice_items", "service_code")
    op.drop_column("invoice_items", "tax_rate")
    op.drop_column("invoice_items", "tax_code")

    op.drop_constraint("fk_invoices_voided_by_user_id_users", "invoices", type_="foreignkey")
    op.drop_constraint("fk_invoices_client_id_clients", "invoices", type_="foreignkey")
    op.drop_constraint("fk_invoices_branch_id_branches", "invoices", type_="foreignkey")
    op.drop_constraint("fk_invoices_bank_id_banks", "invoices", type_="foreignkey")
    op.drop_index("ix_invoices_voided_by_user_id", table_name="invoices")
    op.drop_index("ix_invoices_client_id", table_name="invoices")
    op.drop_index("ix_invoices_branch_id", table_name="invoices")
    op.drop_index("ix_invoices_bank_id", table_name="invoices")
    op.drop_index("ix_invoices_amount_due", table_name="invoices")

    op.drop_column("invoices", "voided_by_user_id")
    op.drop_column("invoices", "void_reason")
    op.drop_column("invoices", "voided_at")
    op.drop_column("invoices", "sent_at")
    op.drop_column("invoices", "client_id")
    op.drop_column("invoices", "branch_id")
    op.drop_column("invoices", "bank_id")
    op.drop_column("invoices", "terms")
    op.drop_column("invoices", "place_of_supply")
    op.drop_column("invoices", "bill_to_gstin")
    op.drop_column("invoices", "bill_to_address")
    op.drop_column("invoices", "bill_to_name")
    op.drop_column("invoices", "amount_credited")
    op.drop_column("invoices", "amount_due")
    op.drop_column("invoices", "amount_paid")
    op.drop_column("invoices", "currency")

    op.alter_column("invoices", "invoice_number", nullable=False)

    if not _is_sqlite():
        op.execute("DROP TYPE IF EXISTS payment_mode")
        op.execute("DROP TYPE IF EXISTS invoice_adjustment_type")
