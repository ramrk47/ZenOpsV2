"""Add WhatsApp opt-in fields to users table.

Revision ID: 0023_add_whatsapp_fields
Revises: 0022_add_partner_account_requests
Create Date: 2026-02-07
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0023_add_whatsapp_fields"
down_revision = "0022_add_partner_account_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("whatsapp_opted_in", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("users", sa.Column("whatsapp_consent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("whatsapp_number", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "whatsapp_number")
    op.drop_column("users", "whatsapp_consent_at")
    op.drop_column("users", "whatsapp_opted_in")
