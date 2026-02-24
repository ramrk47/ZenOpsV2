"""add user capability overrides

Revision ID: 0010_add_user_capability_overrides
Revises: 0009_add_performance_indexes
Create Date: 2026-02-05 13:05:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "0010_add_user_capability_overrides"
down_revision = "0009_add_performance_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "capability_overrides",
            sa.JSON().with_variant(postgresql.JSONB, "postgresql"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "capability_overrides")
