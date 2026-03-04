"""Phase 9 RC: widen partner request status length for onboarding states.

Revision ID: 0042_phase9_partner_request_status_len
Revises: 0041_phase6_associate_self_onboarding
Create Date: 2026-03-04
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0042_phase9_partner_request_status_len"
down_revision: Union[str, None] = "0041_phase6_associate_self_onboarding"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("partner_account_requests") as batch_op:
        batch_op.alter_column(
            "status",
            existing_type=sa.String(length=20),
            type_=sa.String(length=40),
            existing_nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("partner_account_requests") as batch_op:
        batch_op.alter_column(
            "status",
            existing_type=sa.String(length=40),
            type_=sa.String(length=20),
            existing_nullable=False,
        )
