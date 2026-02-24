"""Add partner service lines, extra fields, and commission floors.

Revision ID: 0015_partner_service_lines_floors
Revises: 0014_add_external_partners_commissions
Create Date: 2026-02-06
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0015_partner_service_lines_floors"
down_revision = "0014_add_external_partners_commissions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("external_partners", sa.Column("legal_name", sa.String(length=255), nullable=True))
    op.add_column("external_partners", sa.Column("alternate_contact_name", sa.String(length=255), nullable=True))
    op.add_column("external_partners", sa.Column("alternate_contact_email", sa.String(length=255), nullable=True))
    op.add_column("external_partners", sa.Column("alternate_contact_phone", sa.String(length=50), nullable=True))
    op.add_column("external_partners", sa.Column("billing_city", sa.String(length=100), nullable=True))
    op.add_column("external_partners", sa.Column("billing_state", sa.String(length=100), nullable=True))
    op.add_column("external_partners", sa.Column("billing_postal_code", sa.String(length=20), nullable=True))
    op.add_column("external_partners", sa.Column("service_lines", sa.JSON(), nullable=True))
    op.add_column(
        "external_partners",
        sa.Column("multi_floor_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("external_partners", sa.Column("notes", sa.Text(), nullable=True))

    op.add_column(
        "commission_requests",
        sa.Column(
            "service_line",
            sa.Enum("VALUATION", "INDUSTRIAL", "DPR", "CMA", name="service_line", create_type=False),
            nullable=True,
        ),
    )
    op.create_index("ix_commission_requests_service_line", "commission_requests", ["service_line"], unique=False)

    op.create_table(
        "commission_request_floor_areas",
        sa.Column("commission_request_id", sa.Integer(), nullable=False),
        sa.Column("floor_name", sa.String(length=255), nullable=False),
        sa.Column("area", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["commission_request_id"], ["commission_requests.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_commission_request_floor_areas_commission_request_id",
        "commission_request_floor_areas",
        ["commission_request_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_commission_request_floor_areas_commission_request_id",
        table_name="commission_request_floor_areas",
    )
    op.drop_table("commission_request_floor_areas")

    op.drop_index("ix_commission_requests_service_line", table_name="commission_requests")
    op.drop_column("commission_requests", "service_line")

    op.drop_column("external_partners", "notes")
    op.drop_column("external_partners", "multi_floor_enabled")
    op.drop_column("external_partners", "service_lines")
    op.drop_column("external_partners", "billing_postal_code")
    op.drop_column("external_partners", "billing_state")
    op.drop_column("external_partners", "billing_city")
    op.drop_column("external_partners", "alternate_contact_phone")
    op.drop_column("external_partners", "alternate_contact_email")
    op.drop_column("external_partners", "alternate_contact_name")
    op.drop_column("external_partners", "legal_name")
