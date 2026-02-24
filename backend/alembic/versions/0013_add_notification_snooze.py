"""Add snoozed_until to notifications.

Revision ID: 0013_add_notification_snooze
Revises: 0012_backfill_invoice_totals
Create Date: 2026-02-06
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0013_add_notification_snooze"
down_revision = "0012_backfill_invoice_totals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("notifications", sa.Column("snoozed_until", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_notifications_snoozed_until", "notifications", ["snoozed_until"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_notifications_snoozed_until", table_name="notifications")
    op.drop_column("notifications", "snoozed_until")
