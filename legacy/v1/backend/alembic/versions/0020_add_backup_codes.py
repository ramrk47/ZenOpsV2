"""Add backup_codes_hash column to users for MFA recovery.

Revision ID: 0020_add_backup_codes
Revises: 0019_add_revoked_tokens
Create Date: 2026-02-07
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0020_add_backup_codes"
down_revision = "0019_add_revoked_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("backup_codes_hash", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "backup_codes_hash")
