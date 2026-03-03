"""Phase 8 auth hardening: shared DB-backed rate limit buckets.

Revision ID: 0040_phase8_rate_limit_buckets
Revises: 0039_phase7_allocation_policy_prefs
Create Date: 2026-03-04
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0040_phase8_rate_limit_buckets"
down_revision: Union[str, None] = "0039_phase7_allocation_policy_prefs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rate_limit_buckets",
        sa.Column("key", sa.String(length=255), nullable=False),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_rate_limit_buckets")),
    )
    op.create_index(
        op.f("ix_rate_limit_buckets_window_start"),
        "rate_limit_buckets",
        ["window_start"],
        unique=False,
    )
    op.create_index(
        op.f("ix_rate_limit_buckets_updated_at"),
        "rate_limit_buckets",
        ["updated_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_rate_limit_buckets_updated_at"), table_name="rate_limit_buckets")
    op.drop_index(op.f("ix_rate_limit_buckets_window_start"), table_name="rate_limit_buckets")
    op.drop_table("rate_limit_buckets")
