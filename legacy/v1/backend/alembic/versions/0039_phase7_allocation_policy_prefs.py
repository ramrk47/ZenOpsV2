"""Phase 7 allocation policy + personnel allocation prefs.

Revision ID: 0039_phase7_allocation_policy_prefs
Revises: 0038_phase6_associate_onboarding
Create Date: 2026-03-03
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0039_phase7_allocation_policy_prefs"
down_revision: Union[str, None] = "0038_phase6_associate_onboarding"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("service_lines") as batch_op:
        batch_op.add_column(sa.Column("allocation_policy_json", sa.JSON(), nullable=True))

    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("allocation_prefs_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("allocation_prefs_json")

    with op.batch_alter_table("service_lines") as batch_op:
        batch_op.drop_column("allocation_policy_json")
