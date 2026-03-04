"""Phase 6 self-serve associate onboarding lifecycle fields.

Revision ID: 0041_phase6_associate_self_onboarding
Revises: 0040_phase8_rate_limit_buckets
Create Date: 2026-03-04
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0041_phase6_associate_self_onboarding"
down_revision: Union[str, None] = "0040_phase8_rate_limit_buckets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("partner_account_requests") as batch_op:
        batch_op.add_column(sa.Column("city", sa.String(length=120), nullable=True))
        batch_op.add_column(sa.Column("role_intent", sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column("requested_interface", sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column("metadata_json", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("token_consumed_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.create_index(
            op.f("ix_partner_account_requests_token_expires_at"),
            ["token_expires_at"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("partner_account_requests") as batch_op:
        batch_op.drop_index(op.f("ix_partner_account_requests_token_expires_at"))
        batch_op.drop_column("approved_at")
        batch_op.drop_column("token_consumed_at")
        batch_op.drop_column("token_expires_at")
        batch_op.drop_column("metadata_json")
        batch_op.drop_column("requested_interface")
        batch_op.drop_column("role_intent")
        batch_op.drop_column("city")
