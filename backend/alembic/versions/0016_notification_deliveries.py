"""Add notification delivery tracking and user email preferences.

Revision ID: 0016_notification_deliveries
Revises: 0015_partner_service_lines_floors
Create Date: 2026-02-06
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0016_notification_deliveries"
down_revision = "0015_partner_service_lines_floors"
branch_labels = None
depends_on = None


def upgrade() -> None:
    channel_enum = postgresql.ENUM("IN_APP", "EMAIL", name="notification_channel")
    status_enum = postgresql.ENUM("PENDING", "SENT", "FAILED", name="notification_delivery_status")
    channel_enum.create(op.get_bind(), checkfirst=True)
    status_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "notification_deliveries",
        sa.Column("notification_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "channel",
            postgresql.ENUM("IN_APP", "EMAIL", name="notification_channel", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "status",
            postgresql.ENUM("PENDING", "SENT", "FAILED", name="notification_delivery_status", create_type=False),
            nullable=False,
        ),
        sa.Column("to_address", sa.String(length=320), nullable=True),
        sa.Column("entity_key", sa.String(length=120), nullable=True),
        sa.Column("provider_message_id", sa.String(length=255), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["notification_id"], ["notifications.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_notification_deliveries_notification_id",
        "notification_deliveries",
        ["notification_id"],
        unique=False,
    )
    op.create_index(
        "ix_notification_deliveries_user_id",
        "notification_deliveries",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_notification_deliveries_channel",
        "notification_deliveries",
        ["channel"],
        unique=False,
    )
    op.create_index(
        "ix_notification_deliveries_status",
        "notification_deliveries",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_notification_deliveries_entity_key",
        "notification_deliveries",
        ["entity_key"],
        unique=False,
    )

    op.create_table(
        "user_notification_prefs",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("email_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )


def downgrade() -> None:
    op.drop_table("user_notification_prefs")

    op.drop_index("ix_notification_deliveries_entity_key", table_name="notification_deliveries")
    op.drop_index("ix_notification_deliveries_status", table_name="notification_deliveries")
    op.drop_index("ix_notification_deliveries_channel", table_name="notification_deliveries")
    op.drop_index("ix_notification_deliveries_user_id", table_name="notification_deliveries")
    op.drop_index("ix_notification_deliveries_notification_id", table_name="notification_deliveries")
    op.drop_table("notification_deliveries")

    status_enum = postgresql.ENUM("PENDING", "SENT", "FAILED", name="notification_delivery_status")
    channel_enum = postgresql.ENUM("IN_APP", "EMAIL", name="notification_channel")
    status_enum.drop(op.get_bind(), checkfirst=True)
    channel_enum.drop(op.get_bind(), checkfirst=True)
