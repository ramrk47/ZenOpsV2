"""Expand notification enum values for task alerts.

Revision ID: 0004_expand_notification_types
Revises: 0003_expand_approval_actions
Create Date: 2026-01-28
"""

from __future__ import annotations

from alembic import op

revision = "0004_expand_notification_types"
down_revision = "0003_expand_approval_actions"
branch_labels = None
depends_on = None


NEW_VALUES = [
    "TASK_ASSIGNED",
    "TASK_UPDATED",
]


def _is_sqlite() -> bool:
    return op.get_bind().dialect.name == "sqlite"


def upgrade() -> None:
    if _is_sqlite():
        return
    for value in NEW_VALUES:
        op.execute(f"ALTER TYPE notification_type ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    pass
