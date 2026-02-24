"""Expand approval action enum values.

Revision ID: 0003_expand_approval_actions
Revises: 0002_ops_upgrades
Create Date: 2026-01-27
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "0003_expand_approval_actions"
down_revision = "0002_ops_upgrades"
branch_labels = None
depends_on = None


NEW_VALUES = [
    "DOC_REQUEST",
    "FIELD_VISIT",
    "FINAL_REVIEW",
    "CLIENT_CALL",
    "PAYMENT_FOLLOWUP",
    "EXCEPTION",
]


def _is_sqlite() -> bool:
    return op.get_bind().dialect.name == "sqlite"


def upgrade() -> None:
    if _is_sqlite():
        return
    for value in NEW_VALUES:
        op.execute(f"ALTER TYPE approval_action_type ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    # Enum value removal is not supported safely; downgrade is a no-op.
    pass
