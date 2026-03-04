"""Phase 4 policy-driven land details and service line master data.

Revision ID: 0037_phase4_policy_driven_land
Revises: 0036_phase2_approvals
Create Date: 2026-03-03
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0037_phase4_policy_driven_land"
down_revision: Union[str, None] = "0036_phase2_approvals"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


SERVICE_LINES = [
    {"key": "VALUATION_LB", "name": "Valuation (Land & Building)", "sort_order": 10, "is_active": True},
    {"key": "VALUATION_PLOT", "name": "Valuation (Plot)", "sort_order": 20, "is_active": True},
    {"key": "VALUATION_AGRI", "name": "Valuation (Agri Land)", "sort_order": 30, "is_active": True},
    {"key": "HOME_LOAN", "name": "Home Loans", "sort_order": 40, "is_active": True},
    {"key": "PROJECT_REPORT", "name": "Project Report", "sort_order": 50, "is_active": True},
    {"key": "LAND_DEVELOPMENT", "name": "Land Development", "sort_order": 60, "is_active": True},
    {"key": "DCC", "name": "DCC", "sort_order": 70, "is_active": True},
    {"key": "PROGRESS_COMPLETION", "name": "Progress / Completion Report", "sort_order": 80, "is_active": True},
    {"key": "OTHERS", "name": "Others", "sort_order": 999, "is_active": True},
]


SERVICE_LINE_POLICIES = {
    "VALUATION_LB": {
        "requires": ["NORMAL_LAND", "BUILT_UP"],
        "optional": ["SURVEY_ROWS"],
        "uom_required": True,
        "allow_assignment_override": True,
        "notes": "Standard L&B valuation. Survey rows optional if site data includes survey breakdown.",
    },
    "VALUATION_PLOT": {
        "requires": ["NORMAL_LAND"],
        "optional": ["SURVEY_ROWS"],
        "uom_required": True,
        "allow_assignment_override": True,
        "notes": "Plot valuations typically only need land area; survey rows optional.",
    },
    "VALUATION_AGRI": {
        "requires": ["SURVEY_ROWS"],
        "optional": ["NORMAL_LAND"],
        "uom_required": True,
        "allow_assignment_override": True,
        "notes": "Agri valuations need survey-wise breakup + kharab.",
    },
    "HOME_LOAN": {
        "requires": ["NORMAL_LAND", "BUILT_UP"],
        "optional": ["SURVEY_ROWS"],
        "uom_required": True,
        "allow_assignment_override": True,
        "notes": "Home loan valuations usually need land + built-up.",
    },
    "PROGRESS_COMPLETION": {
        "requires": ["BUILT_UP"],
        "optional": ["NORMAL_LAND"],
        "uom_required": True,
        "allow_assignment_override": True,
        "notes": "Progress/completion is construction-focused.",
    },
    "LAND_DEVELOPMENT": {
        "requires": ["NORMAL_LAND"],
        "optional": ["SURVEY_ROWS"],
        "uom_required": True,
        "allow_assignment_override": True,
        "notes": "Land development generally requires land details.",
    },
    "DCC": {
        "requires": ["NORMAL_LAND"],
        "optional": ["BUILT_UP", "SURVEY_ROWS"],
        "uom_required": True,
        "allow_assignment_override": True,
        "notes": "DCC can vary; keep flexible with optional blocks.",
    },
    "PROJECT_REPORT": {
        "requires": ["NORMAL_LAND"],
        "optional": ["BUILT_UP", "SURVEY_ROWS"],
        "uom_required": True,
        "allow_assignment_override": True,
        "notes": "Project reports vary; start with land required.",
    },
    "OTHERS": {
        "requires": [],
        "optional": ["NORMAL_LAND", "BUILT_UP", "SURVEY_ROWS"],
        "uom_required": True,
        "allow_assignment_override": True,
        "notes": "Others requires manual selection/override at assignment time.",
    },
}


def upgrade() -> None:
    op.create_table(
        "service_lines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key", name="uq_service_lines_key"),
        sa.UniqueConstraint("name", name="uq_service_lines_name"),
    )
    op.create_index("ix_service_lines_key", "service_lines", ["key"], unique=False)
    op.create_index("ix_service_lines_name", "service_lines", ["name"], unique=False)
    op.create_index("ix_service_lines_is_active", "service_lines", ["is_active"], unique=False)

    op.create_table(
        "service_line_policies",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("service_line_id", sa.Integer(), nullable=False),
        sa.Column("policy_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["service_line_id"], ["service_lines.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("service_line_id", name="uq_service_line_policies_service_line_id"),
    )
    op.create_index("ix_service_line_policies_service_line_id", "service_line_policies", ["service_line_id"], unique=False)

    with op.batch_alter_table("assignments") as batch_op:
        batch_op.add_column(sa.Column("service_line_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("service_line_other_text", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("uom", sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column("land_policy_override_json", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("payment_timing", sa.String(length=16), nullable=True))
        batch_op.add_column(sa.Column("payment_completeness", sa.String(length=16), nullable=True))
        batch_op.add_column(sa.Column("preferred_payment_mode", sa.String(length=32), nullable=True))
        batch_op.create_index("ix_assignments_service_line_id", ["service_line_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_assignments_service_line_id_service_lines",
            "service_lines",
            ["service_line_id"],
            ["id"],
        )

    op.create_table(
        "assignment_land_surveys",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("assignment_id", sa.Integer(), nullable=False),
        sa.Column("serial_no", sa.Integer(), nullable=False),
        sa.Column("survey_no", sa.String(length=120), nullable=False),
        sa.Column("acre", sa.Numeric(12, 3), nullable=False, server_default="0"),
        sa.Column("gunta", sa.Numeric(12, 3), nullable=False, server_default="0"),
        sa.Column("aana", sa.Numeric(12, 3), nullable=False, server_default="0"),
        sa.Column("kharab_acre", sa.Numeric(12, 3), nullable=False, server_default="0"),
        sa.Column("kharab_gunta", sa.Numeric(12, 3), nullable=False, server_default="0"),
        sa.Column("kharab_aana", sa.Numeric(12, 3), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["assignment_id"], ["assignments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_assignment_land_surveys_assignment_id", "assignment_land_surveys", ["assignment_id"], unique=False)
    op.create_index(
        "ix_assignment_land_surveys_assignment_serial",
        "assignment_land_surveys",
        ["assignment_id", "serial_no"],
        unique=False,
    )

    service_lines_table = sa.table(
        "service_lines",
        sa.column("key", sa.String),
        sa.column("name", sa.String),
        sa.column("is_active", sa.Boolean),
        sa.column("sort_order", sa.Integer),
    )
    op.bulk_insert(service_lines_table, SERVICE_LINES)

    bind = op.get_bind()
    id_by_key = {
        row.key: row.id
        for row in bind.execute(sa.text("SELECT id, key FROM service_lines")).fetchall()
    }

    policies_table = sa.table(
        "service_line_policies",
        sa.column("service_line_id", sa.Integer),
        sa.column("policy_json", sa.JSON),
    )
    policy_rows = []
    for key, policy in SERVICE_LINE_POLICIES.items():
        service_line_id = id_by_key.get(key)
        if service_line_id is None:
            continue
        policy_rows.append({"service_line_id": service_line_id, "policy_json": policy})
    if policy_rows:
        op.bulk_insert(policies_table, policy_rows)

    op.execute(
        """
        UPDATE assignments
        SET service_line_id = (
            SELECT id FROM service_lines WHERE key = 'VALUATION_LB'
        )
        WHERE service_line = 'VALUATION' AND service_line_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE assignments
        SET service_line_id = (
            SELECT id FROM service_lines WHERE key = 'PROJECT_REPORT'
        )
        WHERE service_line IN ('DPR', 'INDUSTRIAL', 'CMA') AND service_line_id IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_assignment_land_surveys_assignment_serial", table_name="assignment_land_surveys")
    op.drop_index("ix_assignment_land_surveys_assignment_id", table_name="assignment_land_surveys")
    op.drop_table("assignment_land_surveys")

    with op.batch_alter_table("assignments") as batch_op:
        batch_op.drop_constraint("fk_assignments_service_line_id_service_lines", type_="foreignkey")
        batch_op.drop_index("ix_assignments_service_line_id")
        batch_op.drop_column("preferred_payment_mode")
        batch_op.drop_column("payment_completeness")
        batch_op.drop_column("payment_timing")
        batch_op.drop_column("land_policy_override_json")
        batch_op.drop_column("uom")
        batch_op.drop_column("service_line_other_text")
        batch_op.drop_column("service_line_id")

    op.drop_index("ix_service_line_policies_service_line_id", table_name="service_line_policies")
    op.drop_table("service_line_policies")

    op.drop_index("ix_service_lines_is_active", table_name="service_lines")
    op.drop_index("ix_service_lines_name", table_name="service_lines")
    op.drop_index("ix_service_lines_key", table_name="service_lines")
    op.drop_table("service_lines")
