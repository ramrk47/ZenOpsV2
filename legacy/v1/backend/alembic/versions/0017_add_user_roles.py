"""Add multi-role support for users.

Revision ID: 0017_add_user_roles
Revises: 0016_notification_deliveries
Create Date: 2026-02-07
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0017_add_user_roles"
down_revision = "0016_notification_deliveries"
branch_labels = None
depends_on = None


def _is_sqlite() -> bool:
    return op.get_bind().dialect.name == "sqlite"


def upgrade() -> None:
    if _is_sqlite():
        roles_type = sa.JSON()
    else:
        roles_type = postgresql.JSONB(astext_type=sa.Text())

    op.add_column("users", sa.Column("roles", roles_type, nullable=True))

    if not _is_sqlite():
        op.execute("UPDATE users SET roles = jsonb_build_array(role::text) WHERE roles IS NULL")


def downgrade() -> None:
    op.drop_column("users", "roles")
