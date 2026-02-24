"""Ops upgrades: subtypes, multi-assignees, floors, calendar labels, invoice pdf

Revision ID: 0002_ops_upgrades
Revises: 0001_initial
Create Date: 2026-01-27
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0002_ops_upgrades"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


calendar_event_type_enum = postgresql.ENUM(
    "SITE_VISIT",
    "REPORT_DUE",
    "DOC_PICKUP",
    "INTERNAL_MEETING",
    "TASK_DUE",
    "LEAVE",
    name="calendar_event_type",
    create_type=False,
)


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    ]


def upgrade() -> None:
    # Property subtypes extend property types with more specific templates/checklists.
    op.create_table(
        "property_subtypes",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("property_type_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.ForeignKeyConstraint(["property_type_id"], ["property_types.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("property_type_id", "name", name="uq_property_subtypes_type_name"),
        *_timestamps(),
    )
    op.create_index("ix_property_subtypes_property_type_id", "property_subtypes", ["property_type_id"], unique=False)
    op.create_index("ix_property_subtypes_name", "property_subtypes", ["name"], unique=False)

    # Company profile holds invoice header/GST/state details.
    op.create_table(
        "company_profiles",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("business_name", sa.String(length=255), nullable=False),
        sa.Column("legal_name", sa.String(length=255), nullable=True),
        sa.Column("tagline", sa.String(length=255), nullable=True),
        sa.Column("address_line1", sa.String(length=255), nullable=True),
        sa.Column("address_line2", sa.String(length=255), nullable=True),
        sa.Column("city", sa.String(length=100), nullable=True),
        sa.Column("state_name", sa.String(length=100), nullable=True),
        sa.Column("state_code", sa.String(length=10), nullable=True),
        sa.Column("postal_code", sa.String(length=20), nullable=True),
        sa.Column("country", sa.String(length=100), nullable=True),
        sa.Column("gstin", sa.String(length=50), nullable=True),
        sa.Column("pan", sa.String(length=50), nullable=True),
        sa.Column("contact_email", sa.String(length=255), nullable=True),
        sa.Column("contact_phone", sa.String(length=50), nullable=True),
        sa.Column("website", sa.String(length=255), nullable=True),
        sa.Column("default_gst_rate", sa.Numeric(5, 2), nullable=False, server_default="18.00"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        *_timestamps(),
    )

    # Calendar labels provide custom event tags (holiday, company meeting, etc.).
    op.create_table(
        "calendar_event_labels",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "default_event_type",
            calendar_event_type_enum,
            nullable=False,
            server_default="INTERNAL_MEETING",
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.UniqueConstraint("name", name="uq_calendar_event_labels_name"),
        *_timestamps(),
    )
    op.create_index("ix_calendar_event_labels_name", "calendar_event_labels", ["name"], unique=False)

    # Assignment multi-assignee links.
    op.create_table(
        "assignment_assignees",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("assignment_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["assignment_id"], ["assignments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("assignment_id", "user_id", name="uq_assignment_assignees_assignment_user"),
        *_timestamps(),
    )
    op.create_index("ix_assignment_assignees_assignment_id", "assignment_assignees", ["assignment_id"], unique=False)
    op.create_index("ix_assignment_assignees_user_id", "assignment_assignees", ["user_id"], unique=False)

    # Assignment floor-wise built-up area details.
    op.create_table(
        "assignment_floor_areas",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("assignment_id", sa.Integer(), nullable=False),
        sa.Column("floor_name", sa.String(length=100), nullable=False),
        sa.Column("area", sa.Numeric(12, 2), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["assignment_id"], ["assignments.id"], ondelete="CASCADE"),
        *_timestamps(),
    )
    op.create_index("ix_assignment_floor_areas_assignment_id", "assignment_floor_areas", ["assignment_id"], unique=False)

    # --- Table alterations ---

    # assignments: add subtype ref
    with op.batch_alter_table("assignments") as batch_op:
        batch_op.add_column(sa.Column("property_subtype_id", sa.Integer(), nullable=True))
        batch_op.create_index("ix_assignments_property_subtype_id", ["property_subtype_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_assignments_property_subtype_id_property_subtypes",
            "property_subtypes",
            ["property_subtype_id"],
            ["id"],
            ondelete="SET NULL",
        )

    # document templates: add subtype ref
    with op.batch_alter_table("document_checklist_templates") as batch_op:
        batch_op.add_column(sa.Column("property_subtype_id", sa.Integer(), nullable=True))
        batch_op.create_index(
            "ix_document_checklist_templates_property_subtype_id",
            ["property_subtype_id"],
            unique=False,
        )
        batch_op.create_foreign_key(
            "fk_doc_templates_subtype_id_subtypes",
            "property_subtypes",
            ["property_subtype_id"],
            ["id"],
            ondelete="CASCADE",
        )

    # company accounts: optionally tie account to commissioning bank
    with op.batch_alter_table("company_accounts") as batch_op:
        batch_op.add_column(sa.Column("bank_id", sa.Integer(), nullable=True))
        batch_op.create_index("ix_company_accounts_bank_id", ["bank_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_company_accounts_bank_id_banks",
            "banks",
            ["bank_id"],
            ["id"],
            ondelete="SET NULL",
        )

    # calendar events: multi-assignees + assign-to-all + label
    with op.batch_alter_table("calendar_events") as batch_op:
        batch_op.add_column(sa.Column("assigned_to_all", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("assigned_user_ids", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("event_label_id", sa.Integer(), nullable=True))
        batch_op.create_index("ix_calendar_events_assigned_to_all", ["assigned_to_all"], unique=False)
        batch_op.create_index("ix_calendar_events_event_label_id", ["event_label_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_calendar_events_event_label_id_calendar_event_labels",
            "calendar_event_labels",
            ["event_label_id"],
            ["id"],
            ondelete="SET NULL",
        )

    # invoices: track PDF generation status
    with op.batch_alter_table("invoices") as batch_op:
        batch_op.add_column(sa.Column("pdf_generated_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("pdf_path", sa.String(length=500), nullable=True))
        batch_op.add_column(sa.Column("pdf_generated_by_user_id", sa.Integer(), nullable=True))
        batch_op.create_index("ix_invoices_pdf_generated_at", ["pdf_generated_at"], unique=False)
        batch_op.create_index("ix_invoices_pdf_generated_by_user_id", ["pdf_generated_by_user_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_invoices_pdf_generated_by_user_id_users",
            "users",
            ["pdf_generated_by_user_id"],
            ["id"],
        )


def downgrade() -> None:
    # --- Drop columns/constraints in reverse order ---
    with op.batch_alter_table("invoices") as batch_op:
        batch_op.drop_constraint("fk_invoices_pdf_generated_by_user_id_users", type_="foreignkey")
        batch_op.drop_index("ix_invoices_pdf_generated_by_user_id")
        batch_op.drop_index("ix_invoices_pdf_generated_at")
        batch_op.drop_column("pdf_generated_by_user_id")
        batch_op.drop_column("pdf_path")
        batch_op.drop_column("pdf_generated_at")

    with op.batch_alter_table("calendar_events") as batch_op:
        batch_op.drop_constraint("fk_calendar_events_event_label_id_calendar_event_labels", type_="foreignkey")
        batch_op.drop_index("ix_calendar_events_event_label_id")
        batch_op.drop_index("ix_calendar_events_assigned_to_all")
        batch_op.drop_column("event_label_id")
        batch_op.drop_column("assigned_user_ids")
        batch_op.drop_column("assigned_to_all")

    with op.batch_alter_table("company_accounts") as batch_op:
        batch_op.drop_constraint("fk_company_accounts_bank_id_banks", type_="foreignkey")
        batch_op.drop_index("ix_company_accounts_bank_id")
        batch_op.drop_column("bank_id")

    with op.batch_alter_table("document_checklist_templates") as batch_op:
        batch_op.drop_constraint("fk_doc_templates_subtype_id_subtypes", type_="foreignkey")
        batch_op.drop_index("ix_document_checklist_templates_property_subtype_id")
        batch_op.drop_column("property_subtype_id")

    with op.batch_alter_table("assignments") as batch_op:
        batch_op.drop_constraint("fk_assignments_property_subtype_id_property_subtypes", type_="foreignkey")
        batch_op.drop_index("ix_assignments_property_subtype_id")
        batch_op.drop_column("property_subtype_id")

    # --- Drop new tables ---
    op.drop_index("ix_assignment_floor_areas_assignment_id", table_name="assignment_floor_areas")
    op.drop_table("assignment_floor_areas")

    op.drop_index("ix_assignment_assignees_user_id", table_name="assignment_assignees")
    op.drop_index("ix_assignment_assignees_assignment_id", table_name="assignment_assignees")
    op.drop_table("assignment_assignees")

    op.drop_index("ix_calendar_event_labels_name", table_name="calendar_event_labels")
    op.drop_table("calendar_event_labels")

    op.drop_table("company_profiles")

    op.drop_index("ix_property_subtypes_name", table_name="property_subtypes")
    op.drop_index("ix_property_subtypes_property_type_id", table_name="property_subtypes")
    op.drop_table("property_subtypes")
