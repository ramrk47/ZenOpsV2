"""Add V1 outbox events table

Revision ID: 0035_add_v1_outbox_events
Revises: 0034_create_payroll_policies
Create Date: 2026-02-27
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0035_add_v1_outbox_events"
down_revision: Union[str, None] = "0034_create_payroll_policies"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "v1_outbox_events" in inspector.get_table_names():
        return

    op.create_table(
        "v1_outbox_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("event_id", sa.String(length=128), nullable=False),
        sa.Column("event_type", sa.String(length=120), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="PENDING"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_unique_constraint("uq_v1_outbox_events_event_id", "v1_outbox_events", ["event_id"])
    op.create_index("ix_v1_outbox_events_status_available_at", "v1_outbox_events", ["status", "available_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_v1_outbox_events_status_available_at", table_name="v1_outbox_events")
    op.drop_constraint("uq_v1_outbox_events_event_id", "v1_outbox_events", type_="unique")
    op.drop_table("v1_outbox_events")
