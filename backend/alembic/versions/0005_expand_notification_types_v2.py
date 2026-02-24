"""Expand notification enum values for approvals and assignment SLA.

Revision ID: 0005_expand_notification_types_v2
Revises: 0004_expand_notification_types
Create Date: 2026-01-29
"""

from __future__ import annotations

from alembic import op

revision = "0005_expand_notification_types_v2"
down_revision = "0004b_extend_alembic_version_len"
branch_labels = None
depends_on = None


NEW_VALUES = [
    "APPROVAL_APPROVED",
    "APPROVAL_REJECTED",
    "ASSIGNMENT_ASSIGNED",
    "ASSIGNMENT_REASSIGNED",
    "SLA_DUE_SOON",
    "TASK_DUE_SOON",
    "TASK_OVERDUE",
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
