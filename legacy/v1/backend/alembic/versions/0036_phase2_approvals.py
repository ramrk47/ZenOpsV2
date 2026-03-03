"""Phase 2 approvals governance: typed approvals, draft statuses, payment confirmation

Revision ID: 0036_phase2_approvals
Revises: 0035_add_v1_outbox_events
Create Date: 2026-03-03
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0036_phase2_approvals"
down_revision: Union[str, None] = "0035_add_v1_outbox_events"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _is_sqlite() -> bool:
    return op.get_bind().dialect.name == "sqlite"


def upgrade() -> None:
    sqlite = _is_sqlite()

    if not sqlite:
        op.execute("ALTER TYPE assignment_status ADD VALUE IF NOT EXISTS 'DRAFT_PENDING_APPROVAL'")
        op.execute("ALTER TYPE assignment_status ADD VALUE IF NOT EXISTS 'DRAFT_REJECTED'")
        op.execute("ALTER TYPE approval_entity_type ADD VALUE IF NOT EXISTS 'DOCUMENT'")
        op.execute("ALTER TYPE approval_entity_type ADD VALUE IF NOT EXISTS 'PAYMENT'")
        op.execute("ALTER TYPE documentreviewstatus ADD VALUE IF NOT EXISTS 'FINAL_PENDING_APPROVAL'")
        op.execute(
            """
            DO $$
            BEGIN
                CREATE TYPE approval_type AS ENUM (
                    'DRAFT_ASSIGNMENT',
                    'FINAL_DOC_REVIEW',
                    'PAYMENT_CONFIRMATION'
                );
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END
            $$;
            """
        )

    approval_type_col = (
        postgresql.ENUM(
            "DRAFT_ASSIGNMENT",
            "FINAL_DOC_REVIEW",
            "PAYMENT_CONFIRMATION",
            name="approval_type",
            create_type=False,
        )
        if not sqlite
        else sa.String(length=40)
    )

    with op.batch_alter_table("approvals") as batch_op:
        batch_op.add_column(sa.Column("approval_type", approval_type_col, nullable=True))
        batch_op.add_column(sa.Column("requested_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("decision_reason", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("metadata_json", sa.JSON(), nullable=True))

    op.execute("UPDATE approvals SET requested_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE requested_at IS NULL")
    if not sqlite:
        op.alter_column("approvals", "requested_at", nullable=False)

    op.create_index(
        "ix_approvals_status_type_requested_at",
        "approvals",
        ["status", "approval_type", "requested_at"],
        unique=False,
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_approvals_pending_entity_type_id "
        "ON approvals(entity_type, entity_id, approval_type) "
        "WHERE status = 'PENDING' AND approval_type IS NOT NULL"
    )

    with op.batch_alter_table("invoice_payments") as batch_op:
        batch_op.add_column(
            sa.Column(
                "confirmation_status",
                sa.String(length=32),
                nullable=False,
                server_default="CONFIRMED",
            )
        )
        batch_op.add_column(sa.Column("confirmed_by_user_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("confirmation_reason", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("approval_id", sa.Integer(), nullable=True))
        batch_op.create_index("ix_invoice_payments_confirmation_status", ["confirmation_status"], unique=False)
        batch_op.create_index("ix_invoice_payments_approval_id", ["approval_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_invoice_payments_confirmed_by_user_id_users",
            "users",
            ["confirmed_by_user_id"],
            ["id"],
        )
        batch_op.create_foreign_key(
            "fk_invoice_payments_approval_id_approvals",
            "approvals",
            ["approval_id"],
            ["id"],
        )

    op.execute(
        "UPDATE invoice_payments "
        "SET confirmed_at = COALESCE(confirmed_at, paid_at) "
        "WHERE confirmation_status = 'CONFIRMED'"
    )
    op.alter_column("invoice_payments", "confirmation_status", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("invoice_payments") as batch_op:
        batch_op.drop_constraint("fk_invoice_payments_approval_id_approvals", type_="foreignkey")
        batch_op.drop_constraint("fk_invoice_payments_confirmed_by_user_id_users", type_="foreignkey")
        batch_op.drop_index("ix_invoice_payments_approval_id")
        batch_op.drop_index("ix_invoice_payments_confirmation_status")
        batch_op.drop_column("approval_id")
        batch_op.drop_column("confirmation_reason")
        batch_op.drop_column("confirmed_at")
        batch_op.drop_column("confirmed_by_user_id")
        batch_op.drop_column("confirmation_status")

    op.drop_index("ix_approvals_status_type_requested_at", table_name="approvals")
    op.execute("DROP INDEX IF EXISTS uq_approvals_pending_entity_type_id")

    with op.batch_alter_table("approvals") as batch_op:
        batch_op.drop_column("metadata_json")
        batch_op.drop_column("decision_reason")
        batch_op.drop_column("requested_at")
        batch_op.drop_column("approval_type")

    if not _is_sqlite():
        op.execute("DROP TYPE IF EXISTS approval_type")
    # Enum values added to existing enums are intentionally not removed.
