"""Add work_sessions table for attendance tracking.

Revision ID: 0021_add_work_sessions
Revises: 0020_add_backup_codes
Create Date: 2026-02-07
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0021_add_work_sessions"
down_revision = "0020_add_backup_codes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "work_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("login_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("logout_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_minutes", sa.Integer(), nullable=True),
        sa.Column("session_type", sa.String(10), nullable=False, server_default="AUTO"),
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
    op.create_index(
        "ix_work_sessions_user_login",
        "work_sessions",
        ["user_id", "login_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_work_sessions_user_login", table_name="work_sessions")
    op.drop_table("work_sessions")
