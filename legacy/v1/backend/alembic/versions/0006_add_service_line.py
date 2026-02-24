"""Add service line to assignments.

Revision ID: 0006_add_service_line
Revises: 0005_expand_notification_types_v2
Create Date: 2026-01-29
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0006_add_service_line"
down_revision = "0005_expand_notification_types_v2"
branch_labels = None
depends_on = None


SERVICE_LINE_VALUES = ["VALUATION", "INDUSTRIAL", "DPR", "CMA"]


def _is_sqlite() -> bool:
    return op.get_bind().dialect.name == "sqlite"


def upgrade() -> None:
    service_line_enum = sa.Enum(*SERVICE_LINE_VALUES, name="service_line")
    if not _is_sqlite():
        service_line_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "assignments",
        sa.Column(
            "service_line",
            service_line_enum,
            nullable=False,
            server_default=sa.text("'VALUATION'"),
        ),
    )

    op.execute("UPDATE assignments SET service_line = 'VALUATION' WHERE service_line IS NULL")
    op.alter_column("assignments", "service_line", server_default=None)


def downgrade() -> None:
    op.drop_column("assignments", "service_line")
    if not _is_sqlite():
        op.execute("DROP TYPE IF EXISTS service_line")
