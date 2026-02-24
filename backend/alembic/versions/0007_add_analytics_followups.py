"""Add analytics settings and follow-up tasks.

Revision ID: 0007_add_analytics_followups
Revises: 0006_add_service_line
Create Date: 2026-01-29
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0007_add_analytics_followups"
down_revision = "0006_add_service_line"
branch_labels = None
depends_on = None


def _is_sqlite() -> bool:
    return op.get_bind().dialect.name == "sqlite"


def upgrade() -> None:
    if not _is_sqlite():
        op.execute("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'RELATIONSHIP_ALERT'")

    op.create_table(
        "analytics_settings",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("time_window_days", sa.Integer(), nullable=False, server_default="90"),
        sa.Column("decline_threshold_count", sa.Numeric(5, 2), nullable=False, server_default="0.30"),
        sa.Column("decline_threshold_revenue", sa.Numeric(5, 2), nullable=False, server_default="0.25"),
        sa.Column("inactivity_days", sa.Integer(), nullable=False, server_default="21"),
        sa.Column("baseline_min_count", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("baseline_min_revenue", sa.Numeric(12, 2), nullable=False, server_default="50000.00"),
        sa.Column("followup_cooldown_days", sa.Integer(), nullable=False, server_default="21"),
        sa.Column("outstanding_threshold", sa.Numeric(12, 2), nullable=False, server_default="0.00"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "follow_up_tasks",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("entity_type", sa.String(length=20), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column("entity_label", sa.String(length=255), nullable=False),
        sa.Column("reason_code", sa.String(length=30), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="OPEN"),
        sa.Column("severity", sa.String(length=12), nullable=False, server_default="MEDIUM"),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("assigned_to_user_id", sa.Integer(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("dedupe_key", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["assigned_to_user_id"], ["users.id"], ondelete=None),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete=None),
    )
    op.create_index("ix_follow_up_tasks_entity_type", "follow_up_tasks", ["entity_type"], unique=False)
    op.create_index("ix_follow_up_tasks_entity_id", "follow_up_tasks", ["entity_id"], unique=False)
    op.create_index("ix_follow_up_tasks_reason_code", "follow_up_tasks", ["reason_code"], unique=False)
    op.create_index("ix_follow_up_tasks_status", "follow_up_tasks", ["status"], unique=False)
    op.create_index("ix_follow_up_tasks_assigned_to_user_id", "follow_up_tasks", ["assigned_to_user_id"], unique=False)
    op.create_index("ix_follow_up_tasks_created_by_user_id", "follow_up_tasks", ["created_by_user_id"], unique=False)
    op.create_index("ix_follow_up_tasks_dedupe_key", "follow_up_tasks", ["dedupe_key"], unique=False)

    op.create_table(
        "relationship_logs",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("entity_type", sa.String(length=20), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column("entity_label", sa.String(length=255), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("next_follow_up_date", sa.Date(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete=None),
    )
    op.create_index("ix_relationship_logs_entity_type", "relationship_logs", ["entity_type"], unique=False)
    op.create_index("ix_relationship_logs_entity_id", "relationship_logs", ["entity_id"], unique=False)
    op.create_index("ix_relationship_logs_created_by_user_id", "relationship_logs", ["created_by_user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_relationship_logs_created_by_user_id", table_name="relationship_logs")
    op.drop_index("ix_relationship_logs_entity_id", table_name="relationship_logs")
    op.drop_index("ix_relationship_logs_entity_type", table_name="relationship_logs")
    op.drop_table("relationship_logs")

    op.drop_index("ix_follow_up_tasks_dedupe_key", table_name="follow_up_tasks")
    op.drop_index("ix_follow_up_tasks_created_by_user_id", table_name="follow_up_tasks")
    op.drop_index("ix_follow_up_tasks_assigned_to_user_id", table_name="follow_up_tasks")
    op.drop_index("ix_follow_up_tasks_status", table_name="follow_up_tasks")
    op.drop_index("ix_follow_up_tasks_reason_code", table_name="follow_up_tasks")
    op.drop_index("ix_follow_up_tasks_entity_id", table_name="follow_up_tasks")
    op.drop_index("ix_follow_up_tasks_entity_type", table_name="follow_up_tasks")
    op.drop_table("follow_up_tasks")

    op.drop_table("analytics_settings")

    # Downgrading enums is destructive; keep value in type.
