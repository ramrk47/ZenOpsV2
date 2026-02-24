"""Add external partners and commission workflow.

Revision ID: 0014_add_external_partners_commissions
Revises: 0013_add_notification_snooze
Create Date: 2026-02-06
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0014_add_external_partners_commissions"
down_revision = "0013_add_notification_snooze"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE role ADD VALUE IF NOT EXISTS 'EXTERNAL_PARTNER'")
    for value in [
        "PARTNER_REQUEST_SUBMITTED",
        "PARTNER_REQUEST_NEEDS_INFO",
        "PARTNER_REQUEST_APPROVED",
        "PARTNER_REQUEST_REJECTED",
        "PARTNER_DOC_REQUESTED",
        "PARTNER_DOC_SUBMITTED",
        "PARTNER_PAYMENT_REQUESTED",
        "PARTNER_PAYMENT_PROOF_SUBMITTED",
        "PARTNER_PAYMENT_VERIFIED",
        "PARTNER_DELIVERABLE_RELEASED",
    ]:
        op.execute(f"ALTER TYPE notification_type ADD VALUE IF NOT EXISTS '{value}'")
    op.execute("COMMIT")

    op.create_table(
        "external_partners",
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("contact_name", sa.String(length=255), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("city", sa.String(length=100), nullable=True),
        sa.Column("billing_address", sa.Text(), nullable=True),
        sa.Column("gstin", sa.String(length=50), nullable=True),
        sa.Column("default_payment_terms_days", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_external_partners_display_name", "external_partners", ["display_name"], unique=False)
    op.create_index("ix_external_partners_is_active", "external_partners", ["is_active"], unique=False)

    op.add_column("users", sa.Column("partner_id", sa.Integer(), nullable=True))
    op.create_index("ix_users_partner_id", "users", ["partner_id"], unique=False)
    op.create_foreign_key(
        "fk_users_partner_id_external_partners",
        "users",
        "external_partners",
        ["partner_id"],
        ["id"],
    )
    op.create_check_constraint(
        "partner_role_requires_partner_id",
        "users",
        "role != 'EXTERNAL_PARTNER' OR partner_id IS NOT NULL",
    )

    op.create_table(
        "commission_requests",
        sa.Column("request_code", sa.String(length=50), nullable=False),
        sa.Column("partner_id", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "DRAFT",
                "SUBMITTED",
                "NEEDS_INFO",
                "APPROVED",
                "REJECTED",
                "CONVERTED",
                name="commission_status",
            ),
            nullable=False,
        ),
        sa.Column("bank_id", sa.Integer(), nullable=True),
        sa.Column("branch_id", sa.Integer(), nullable=True),
        sa.Column("client_id", sa.Integer(), nullable=True),
        sa.Column("property_type_id", sa.Integer(), nullable=True),
        sa.Column("property_subtype_id", sa.Integer(), nullable=True),
        sa.Column("bank_name", sa.String(length=255), nullable=True),
        sa.Column("branch_name", sa.String(length=255), nullable=True),
        sa.Column("valuer_client_name", sa.String(length=255), nullable=True),
        sa.Column("property_type", sa.String(length=255), nullable=True),
        sa.Column("borrower_name", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("land_area", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("builtup_area", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("site_visit_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("report_due_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("admin_notes", sa.Text(), nullable=True),
        sa.Column("decision_reason", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("converted_assignment_id", sa.Integer(), nullable=True),
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["bank_id"], ["banks.id"]),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"]),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
        sa.ForeignKeyConstraint(["property_type_id"], ["property_types.id"]),
        sa.ForeignKeyConstraint(["property_subtype_id"], ["property_subtypes.id"]),
        sa.ForeignKeyConstraint(["partner_id"], ["external_partners.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["converted_assignment_id"], ["assignments.id"]),
    )
    op.create_index("ix_commission_requests_request_code", "commission_requests", ["request_code"], unique=True)
    op.create_index("ix_commission_requests_partner_id", "commission_requests", ["partner_id"], unique=False)
    op.create_index("ix_commission_requests_status", "commission_requests", ["status"], unique=False)

    op.add_column("assignments", sa.Column("partner_id", sa.Integer(), nullable=True))
    op.add_column("assignments", sa.Column("commission_request_id", sa.Integer(), nullable=True))
    op.create_index("ix_assignments_partner_id", "assignments", ["partner_id"], unique=False)
    op.create_index("ix_assignments_commission_request_id", "assignments", ["commission_request_id"], unique=False)
    op.create_foreign_key(
        "fk_assignments_partner_id_external_partners",
        "assignments",
        "external_partners",
        ["partner_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_assignments_commission_request_id_commission_requests",
        "assignments",
        "commission_requests",
        ["commission_request_id"],
        ["id"],
    )

    op.add_column("invoices", sa.Column("partner_id", sa.Integer(), nullable=True))
    op.create_index("ix_invoices_partner_id", "invoices", ["partner_id"], unique=False)
    op.create_foreign_key(
        "fk_invoices_partner_id_external_partners",
        "invoices",
        "external_partners",
        ["partner_id"],
        ["id"],
    )

    op.create_table(
        "commission_request_documents",
        sa.Column("commission_request_id", sa.Integer(), nullable=False),
        sa.Column("uploaded_by_user_id", sa.Integer(), nullable=False),
        sa.Column("original_name", sa.String(length=255), nullable=False),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("mime_type", sa.String(length=255), nullable=True),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["commission_request_id"], ["commission_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["users.id"]),
        sa.UniqueConstraint("storage_path", name="uq_commission_request_documents_storage_path"),
    )
    op.create_index(
        "ix_commission_request_documents_commission_request_id",
        "commission_request_documents",
        ["commission_request_id"],
        unique=False,
    )
    op.create_index(
        "ix_commission_request_documents_uploaded_by_user_id",
        "commission_request_documents",
        ["uploaded_by_user_id"],
        unique=False,
    )

    op.create_table(
        "partner_requests",
        sa.Column("partner_id", sa.Integer(), nullable=False),
        sa.Column(
            "direction",
            sa.Enum(
                "INTERNAL_TO_PARTNER",
                "PARTNER_TO_INTERNAL",
                name="partner_request_direction",
            ),
            nullable=False,
        ),
        sa.Column(
            "request_type",
            sa.Enum(
                "DOC_REQUEST",
                "DOC_SUBMITTED",
                "PAYMENT_REQUESTED",
                "PAYMENT_PROOF_SUBMITTED",
                "FINAL_REPORT_RELEASED",
                "INFO_REQUEST",
                "REVISION_REQUEST",
                name="partner_request_type",
            ),
            nullable=False,
        ),
        sa.Column(
            "entity_type",
            sa.Enum("COMMISSION_REQUEST", "ASSIGNMENT", "INVOICE", name="partner_request_entity_type"),
            nullable=False,
        ),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("OPEN", "RESPONDED", "CLOSED", name="partner_request_status"),
            nullable=False,
        ),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_by_partner_user_id", sa.Integer(), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["partner_id"], ["external_partners.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["created_by_partner_user_id"], ["users.id"]),
    )
    op.create_index("ix_partner_requests_partner_id", "partner_requests", ["partner_id"], unique=False)
    op.create_index("ix_partner_requests_status", "partner_requests", ["status"], unique=False)
    op.create_index("ix_partner_requests_entity_id", "partner_requests", ["entity_id"], unique=False)

    op.create_table(
        "partner_request_attachments",
        sa.Column("partner_request_id", sa.Integer(), nullable=False),
        sa.Column("uploaded_by_user_id", sa.Integer(), nullable=True),
        sa.Column("uploaded_by_partner_user_id", sa.Integer(), nullable=True),
        sa.Column("original_name", sa.String(length=255), nullable=False),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("mime_type", sa.String(length=255), nullable=True),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["partner_request_id"], ["partner_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["uploaded_by_partner_user_id"], ["users.id"]),
        sa.UniqueConstraint("storage_path", name="uq_partner_request_attachments_storage_path"),
    )
    op.create_index(
        "ix_partner_request_attachments_partner_request_id",
        "partner_request_attachments",
        ["partner_request_id"],
        unique=False,
    )

    op.create_table(
        "partner_deliverables",
        sa.Column("partner_id", sa.Integer(), nullable=False),
        sa.Column("assignment_id", sa.Integer(), nullable=False),
        sa.Column("document_id", sa.Integer(), nullable=False),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("released_by_user_id", sa.Integer(), nullable=True),
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["partner_id"], ["external_partners.id"]),
        sa.ForeignKeyConstraint(["assignment_id"], ["assignments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["assignment_documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["released_by_user_id"], ["users.id"]),
    )
    op.create_index("ix_partner_deliverables_partner_id", "partner_deliverables", ["partner_id"], unique=False)
    op.create_index("ix_partner_deliverables_assignment_id", "partner_deliverables", ["assignment_id"], unique=False)
    op.create_index("ix_partner_deliverables_document_id", "partner_deliverables", ["document_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_partner_deliverables_document_id", table_name="partner_deliverables")
    op.drop_index("ix_partner_deliverables_assignment_id", table_name="partner_deliverables")
    op.drop_index("ix_partner_deliverables_partner_id", table_name="partner_deliverables")
    op.drop_table("partner_deliverables")

    op.drop_index("ix_partner_request_attachments_partner_request_id", table_name="partner_request_attachments")
    op.drop_table("partner_request_attachments")

    op.drop_index("ix_partner_requests_entity_id", table_name="partner_requests")
    op.drop_index("ix_partner_requests_status", table_name="partner_requests")
    op.drop_index("ix_partner_requests_partner_id", table_name="partner_requests")
    op.drop_table("partner_requests")

    op.drop_index(
        "ix_commission_request_documents_uploaded_by_user_id",
        table_name="commission_request_documents",
    )
    op.drop_index(
        "ix_commission_request_documents_commission_request_id",
        table_name="commission_request_documents",
    )
    op.drop_table("commission_request_documents")

    op.drop_constraint("fk_invoices_partner_id_external_partners", "invoices", type_="foreignkey")
    op.drop_index("ix_invoices_partner_id", table_name="invoices")
    op.drop_column("invoices", "partner_id")

    op.drop_constraint("fk_assignments_commission_request_id_commission_requests", "assignments", type_="foreignkey")
    op.drop_constraint("fk_assignments_partner_id_external_partners", "assignments", type_="foreignkey")
    op.drop_index("ix_assignments_commission_request_id", table_name="assignments")
    op.drop_index("ix_assignments_partner_id", table_name="assignments")
    op.drop_column("assignments", "commission_request_id")
    op.drop_column("assignments", "partner_id")

    op.drop_index("ix_commission_requests_status", table_name="commission_requests")
    op.drop_index("ix_commission_requests_partner_id", table_name="commission_requests")
    op.drop_index("ix_commission_requests_request_code", table_name="commission_requests")
    op.drop_table("commission_requests")

    op.drop_constraint("partner_role_requires_partner_id", "users", type_="check")
    op.drop_constraint("fk_users_partner_id_external_partners", "users", type_="foreignkey")
    op.drop_index("ix_users_partner_id", table_name="users")
    op.drop_column("users", "partner_id")

    op.drop_index("ix_external_partners_is_active", table_name="external_partners")
    op.drop_index("ix_external_partners_display_name", table_name="external_partners")
    op.drop_table("external_partners")
