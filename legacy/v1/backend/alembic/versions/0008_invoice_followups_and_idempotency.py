"""Add invoice follow-ups and idempotency keys.

Revision ID: 0008_invoice_followups_and_idempotency
Revises: 0007_add_analytics_followups
Create Date: 2026-02-05
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0008_invoice_followups_and_idempotency"
down_revision = "0007_add_analytics_followups"
branch_labels = None
depends_on = None


def _is_sqlite() -> bool:
    return op.get_bind().dialect.name == "sqlite"


def upgrade() -> None:
    op.add_column("assignment_tasks", sa.Column("invoice_id", sa.Integer(), nullable=True))
    op.create_index("ix_assignment_tasks_invoice_id", "assignment_tasks", ["invoice_id"], unique=False)
    op.create_foreign_key(
        "fk_assignment_tasks_invoice_id_invoices",
        "assignment_tasks",
        "invoices",
        ["invoice_id"],
        ["id"],
    )

    op.create_table(
        "idempotency_keys",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("scope", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("response_payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete=None),
        sa.UniqueConstraint("key", "scope", "user_id", name="uq_idempotency_key_scope_user"),
    )
    op.create_index("ix_idempotency_keys_key", "idempotency_keys", ["key"], unique=False)
    op.create_index("ix_idempotency_keys_scope", "idempotency_keys", ["scope"], unique=False)
    op.create_index("ix_idempotency_keys_user_id", "idempotency_keys", ["user_id"], unique=False)

    if not _is_sqlite():
        op.execute("ALTER TYPE calendar_event_type ADD VALUE IF NOT EXISTS 'PAYMENT_FOLLOWUP'")

    op.create_index(
        "ux_assignment_tasks_invoice_overdue",
        "assignment_tasks",
        ["invoice_id"],
        unique=True,
        postgresql_where=sa.text("template_type = 'invoice_overdue' AND invoice_id IS NOT NULL"),
        sqlite_where=sa.text("template_type = 'invoice_overdue' AND invoice_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ux_assignment_tasks_invoice_overdue", table_name="assignment_tasks")
    op.drop_index("ix_idempotency_keys_user_id", table_name="idempotency_keys")
    op.drop_index("ix_idempotency_keys_scope", table_name="idempotency_keys")
    op.drop_index("ix_idempotency_keys_key", table_name="idempotency_keys")
    op.drop_table("idempotency_keys")

    op.drop_constraint("fk_assignment_tasks_invoice_id_invoices", "assignment_tasks", type_="foreignkey")
    op.drop_index("ix_assignment_tasks_invoice_id", table_name="assignment_tasks")
    op.drop_column("assignment_tasks", "invoice_id")

    # Downgrading enum values is destructive; keep PAYMENT_FOLLOWUP in type.
