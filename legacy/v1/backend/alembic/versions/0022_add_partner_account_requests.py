"""Add partner_account_requests table for self-service partner onboarding.

Revision ID: 0022_add_partner_account_requests
Revises: 0021_add_work_sessions
Create Date: 2026-02-07
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0022_add_partner_account_requests"
down_revision = "0021_add_work_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "partner_account_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("company_name", sa.String(255), nullable=False),
        sa.Column("contact_name", sa.String(255), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("phone", sa.String(50), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("reviewed_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_partner_account_requests_status", "partner_account_requests", ["status"])
    op.create_index("ix_partner_account_requests_email", "partner_account_requests", ["email"])


def downgrade() -> None:
    op.drop_index("ix_partner_account_requests_email", table_name="partner_account_requests")
    op.drop_index("ix_partner_account_requests_status", table_name="partner_account_requests")
    op.drop_table("partner_account_requests")
