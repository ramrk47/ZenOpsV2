"""Extend alembic_version length to support longer revision ids.

Revision ID: 0004b_extend_alembic_version_len
Revises: 0004_expand_notification_types
Create Date: 2026-01-30
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0004b_extend_alembic_version_len"
down_revision = "0004_expand_notification_types"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(64)")
    elif bind.dialect.name == "mysql":
        op.execute("ALTER TABLE alembic_version MODIFY version_num VARCHAR(64)")
    else:
        try:
            op.alter_column("alembic_version", "version_num", type_=sa.String(64))
        except Exception:
            pass


def downgrade() -> None:
    # Keep length widened; shrinking may fail if longer ids are stored.
    pass
