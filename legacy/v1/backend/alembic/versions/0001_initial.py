"""Initial Zen Ops schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-01-27
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


role_enum = postgresql.ENUM(
    "ADMIN",
    "OPS_MANAGER",
    "HR",
    "FINANCE",
    "ASSISTANT_VALUER",
    "FIELD_VALUER",
    "EMPLOYEE",
    name="role",
    create_type=False,
)

case_type_enum = postgresql.ENUM("BANK", "EXTERNAL_VALUER", "DIRECT_CLIENT", name="case_type", create_type=False)

assignment_status_enum = postgresql.ENUM(
    "PENDING",
    "SITE_VISIT",
    "UNDER_PROCESS",
    "SUBMITTED",
    "COMPLETED",
    "CANCELLED",
    name="assignment_status",
    create_type=False,
)

task_status_enum = postgresql.ENUM("TODO", "DOING", "DONE", "BLOCKED", name="task_status", create_type=False)

approval_status_enum = postgresql.ENUM("PENDING", "APPROVED", "REJECTED", name="approval_status", create_type=False)
approval_entity_type_enum = postgresql.ENUM(
    "ASSIGNMENT",
    "USER",
    "INVOICE",
    "LEAVE",
    name="approval_entity_type",
    create_type=False,
)
approval_action_type_enum = postgresql.ENUM(
    "FEE_OVERRIDE",
    "MARK_PAID",
    "DELETE_ASSIGNMENT",
    "CLOSE_ASSIGNMENT",
    "RESET_PASSWORD",
    "CHANGE_ROLE",
    "REASSIGN",
    "INVOICE_CREATE",
    "INVOICE_UPDATE",
    name="approval_action_type",
    create_type=False,
)

leave_type_enum = postgresql.ENUM("FULL_DAY", "HALF_DAY", "PERMISSION_HOURS", name="leave_type", create_type=False)
leave_status_enum = postgresql.ENUM("PENDING", "APPROVED", "REJECTED", name="leave_status", create_type=False)

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

notification_type_enum = postgresql.ENUM(
    "MISSING_DOC",
    "SLA_DUE_SOON",
    "SLA_OVERDUE",
    "PAYMENT_PENDING",
    "APPROVAL_PENDING",
    "MENTION",
    "LEAVE_APPROVED",
    "LEAVE_REJECTED",
    name="notification_type",
    create_type=False,
)

invoice_status_enum = postgresql.ENUM("DRAFT", "ISSUED", "PAID", "VOID", name="invoice_status", create_type=False)


def upgrade() -> None:
    bind = op.get_bind()
    role_enum.create(bind, checkfirst=True)
    case_type_enum.create(bind, checkfirst=True)
    assignment_status_enum.create(bind, checkfirst=True)
    task_status_enum.create(bind, checkfirst=True)
    approval_status_enum.create(bind, checkfirst=True)
    approval_entity_type_enum.create(bind, checkfirst=True)
    approval_action_type_enum.create(bind, checkfirst=True)
    leave_type_enum.create(bind, checkfirst=True)
    leave_status_enum.create(bind, checkfirst=True)
    calendar_event_type_enum.create(bind, checkfirst=True)
    notification_type_enum.create(bind, checkfirst=True)
    invoice_status_enum.create(bind, checkfirst=True)

    op.create_table(
        "banks",
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("code", name="uq_banks_code"),
        sa.UniqueConstraint("name", name="uq_banks_name"),
    )
    op.create_index("ix_banks_name", "banks", ["name"], unique=False)

    op.create_table(
        "clients",
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("client_type", sa.String(length=100), nullable=True),
        sa.Column("contact_name", sa.String(length=255), nullable=True),
        sa.Column("contact_phone", sa.String(length=50), nullable=True),
        sa.Column("contact_email", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_clients_name", "clients", ["name"], unique=False)

    op.create_table(
        "property_types",
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("name", name="uq_property_types_name"),
    )
    op.create_index("ix_property_types_name", "property_types", ["name"], unique=False)

    op.create_table(
        "users",
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("role", role_enum, nullable=False, server_default="EMPLOYEE"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=False)
    op.create_index("ix_users_is_active", "users", ["is_active"], unique=False)
    op.create_index("ix_users_role", "users", ["role"], unique=False)

    op.create_table(
        "branches",
        sa.Column("bank_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=True),
        sa.Column("city", sa.String(length=100), nullable=True),
        sa.Column("state", sa.String(length=100), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["bank_id"], ["banks.id"], name="fk_branches_bank_id_banks", ondelete="CASCADE"),
    )
    op.create_index("ix_branches_bank_id", "branches", ["bank_id"], unique=False)
    op.create_index("ix_branches_name", "branches", ["name"], unique=False)

    op.create_table(
        "company_accounts",
        sa.Column("account_name", sa.String(length=255), nullable=False),
        sa.Column("account_number", sa.String(length=100), nullable=False),
        sa.Column("ifsc_code", sa.String(length=50), nullable=True),
        sa.Column("bank_name", sa.String(length=255), nullable=False),
        sa.Column("branch_name", sa.String(length=255), nullable=True),
        sa.Column("upi_id", sa.String(length=255), nullable=True),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "document_checklist_templates",
        sa.Column("bank_id", sa.Integer(), nullable=True),
        sa.Column("branch_id", sa.Integer(), nullable=True),
        sa.Column("property_type_id", sa.Integer(), nullable=True),
        sa.Column("case_type", case_type_enum, nullable=True),
        sa.Column("category", sa.String(length=100), nullable=False),
        sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["bank_id"], ["banks.id"], name="fk_document_checklist_templates_bank_id_banks", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], name="fk_document_checklist_templates_branch_id_branches", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["property_type_id"],
            ["property_types.id"],
            name="fk_document_checklist_templates_property_type_id_property_types",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_document_checklist_templates_category", "document_checklist_templates", ["category"], unique=False)

    op.create_table(
        "assignments",
        sa.Column("assignment_code", sa.String(length=50), nullable=False),
        sa.Column("case_type", case_type_enum, nullable=False),
        sa.Column("bank_id", sa.Integer(), nullable=True),
        sa.Column("branch_id", sa.Integer(), nullable=True),
        sa.Column("client_id", sa.Integer(), nullable=True),
        sa.Column("property_type_id", sa.Integer(), nullable=True),
        sa.Column("bank_name", sa.String(length=255), nullable=True),
        sa.Column("branch_name", sa.String(length=255), nullable=True),
        sa.Column("valuer_client_name", sa.String(length=255), nullable=True),
        sa.Column("property_type", sa.String(length=255), nullable=True),
        sa.Column("borrower_name", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("land_area", sa.Numeric(12, 2), nullable=True),
        sa.Column("builtup_area", sa.Numeric(12, 2), nullable=True),
        sa.Column("status", assignment_status_enum, nullable=False, server_default="PENDING"),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("assigned_to_user_id", sa.Integer(), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("report_submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("site_visit_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("report_due_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fees", sa.Numeric(12, 2), nullable=True),
        sa.Column("is_paid", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_user_id", sa.Integer(), nullable=True),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["assigned_to_user_id"], ["users.id"], name="fk_assignments_assigned_to_user_id_users"),
        sa.ForeignKeyConstraint(["bank_id"], ["banks.id"], name="fk_assignments_bank_id_banks"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], name="fk_assignments_branch_id_branches"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], name="fk_assignments_client_id_clients"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], name="fk_assignments_created_by_user_id_users"),
        sa.ForeignKeyConstraint(["deleted_by_user_id"], ["users.id"], name="fk_assignments_deleted_by_user_id_users"),
        sa.ForeignKeyConstraint(["property_type_id"], ["property_types.id"], name="fk_assignments_property_type_id_property_types"),
        sa.UniqueConstraint("assignment_code", name="uq_assignments_assignment_code"),
    )
    op.create_index("ix_assignments_assignment_code", "assignments", ["assignment_code"], unique=False)
    op.create_index("ix_assignments_assigned_to_user_id", "assignments", ["assigned_to_user_id"], unique=False)
    op.create_index("ix_assignments_bank_id", "assignments", ["bank_id"], unique=False)
    op.create_index("ix_assignments_branch_id", "assignments", ["branch_id"], unique=False)
    op.create_index("ix_assignments_borrower_name", "assignments", ["borrower_name"], unique=False)
    op.create_index("ix_assignments_case_type", "assignments", ["case_type"], unique=False)
    op.create_index("ix_assignments_client_id", "assignments", ["client_id"], unique=False)
    op.create_index("ix_assignments_created_by_user_id", "assignments", ["created_by_user_id"], unique=False)
    op.create_index("ix_assignments_is_deleted", "assignments", ["is_deleted"], unique=False)
    op.create_index("ix_assignments_is_paid", "assignments", ["is_paid"], unique=False)
    op.create_index("ix_assignments_property_type_id", "assignments", ["property_type_id"], unique=False)
    op.create_index("ix_assignments_report_due_date", "assignments", ["report_due_date"], unique=False)
    op.create_index("ix_assignments_site_visit_date", "assignments", ["site_visit_date"], unique=False)
    op.create_index("ix_assignments_status", "assignments", ["status"], unique=False)

    op.create_table(
        "calendar_events",
        sa.Column("event_type", calendar_event_type_enum, nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("all_day", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("assignment_id", sa.Integer(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("assigned_to_user_id", sa.Integer(), nullable=True),
        sa.Column("payload_json", sa.JSON(), nullable=True),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["assigned_to_user_id"], ["users.id"], name="fk_calendar_events_assigned_to_user_id_users"),
        sa.ForeignKeyConstraint(["assignment_id"], ["assignments.id"], name="fk_calendar_events_assignment_id_assignments"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], name="fk_calendar_events_created_by_user_id_users"),
    )
    op.create_index("ix_calendar_events_assignment_id", "calendar_events", ["assignment_id"], unique=False)
    op.create_index("ix_calendar_events_assigned_to_user_id", "calendar_events", ["assigned_to_user_id"], unique=False)
    op.create_index("ix_calendar_events_end_at", "calendar_events", ["end_at"], unique=False)
    op.create_index("ix_calendar_events_event_type", "calendar_events", ["event_type"], unique=False)
    op.create_index("ix_calendar_events_start_at", "calendar_events", ["start_at"], unique=False)

    op.create_table(
        "assignment_documents",
        sa.Column("assignment_id", sa.Integer(), nullable=False),
        sa.Column("uploaded_by_user_id", sa.Integer(), nullable=False),
        sa.Column("original_name", sa.String(length=255), nullable=False),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("mime_type", sa.String(length=255), nullable=True),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("version_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("is_final", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["assignment_id"],
            ["assignments.id"],
            name="fk_assignment_documents_assignment_id_assignments",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["users.id"], name="fk_assignment_documents_uploaded_by_user_id_users"),
        sa.UniqueConstraint("storage_path", name="uq_assignment_documents_storage_path"),
    )
    op.create_index("ix_assignment_documents_assignment_id", "assignment_documents", ["assignment_id"], unique=False)
    op.create_index("ix_assignment_documents_category", "assignment_documents", ["category"], unique=False)

    op.create_table(
        "assignment_messages",
        sa.Column("assignment_id", sa.Integer(), nullable=False),
        sa.Column("sender_user_id", sa.Integer(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("mentions", sa.JSON(), nullable=True),
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["assignment_id"],
            ["assignments.id"],
            name="fk_assignment_messages_assignment_id_assignments",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["sender_user_id"], ["users.id"], name="fk_assignment_messages_sender_user_id_users"),
    )
    op.create_index("ix_assignment_messages_assignment_id", "assignment_messages", ["assignment_id"], unique=False)
    op.create_index("ix_assignment_messages_pinned", "assignment_messages", ["pinned"], unique=False)

    op.create_table(
        "assignment_tasks",
        sa.Column("assignment_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", task_status_enum, nullable=False, server_default="TODO"),
        sa.Column("assigned_to_user_id", sa.Integer(), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("template_type", sa.String(length=100), nullable=True),
        sa.Column("calendar_event_id", sa.Integer(), nullable=True),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["assignment_id"],
            ["assignments.id"],
            name="fk_assignment_tasks_assignment_id_assignments",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["assigned_to_user_id"], ["users.id"], name="fk_assignment_tasks_assigned_to_user_id_users"),
        sa.ForeignKeyConstraint(["calendar_event_id"], ["calendar_events.id"], name="fk_assignment_tasks_calendar_event_id_calendar_events"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], name="fk_assignment_tasks_created_by_user_id_users"),
    )
    op.create_index("ix_assignment_tasks_assignment_id", "assignment_tasks", ["assignment_id"], unique=False)
    op.create_index("ix_assignment_tasks_assigned_to_user_id", "assignment_tasks", ["assigned_to_user_id"], unique=False)
    op.create_index("ix_assignment_tasks_due_at", "assignment_tasks", ["due_at"], unique=False)
    op.create_index("ix_assignment_tasks_status", "assignment_tasks", ["status"], unique=False)

    op.create_table(
        "approvals",
        sa.Column("entity_type", approval_entity_type_enum, nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("action_type", approval_action_type_enum, nullable=False),
        sa.Column("requester_user_id", sa.Integer(), nullable=False),
        sa.Column("approver_user_id", sa.Integer(), nullable=True),
        sa.Column("status", approval_status_enum, nullable=False, server_default="PENDING"),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("payload_json", sa.JSON(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("assignment_id", sa.Integer(), nullable=True),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["approver_user_id"], ["users.id"], name="fk_approvals_approver_user_id_users"),
        sa.ForeignKeyConstraint(["assignment_id"], ["assignments.id"], name="fk_approvals_assignment_id_assignments"),
        sa.ForeignKeyConstraint(["requester_user_id"], ["users.id"], name="fk_approvals_requester_user_id_users"),
    )
    op.create_index("ix_approvals_action_type", "approvals", ["action_type"], unique=False)
    op.create_index("ix_approvals_approver_user_id", "approvals", ["approver_user_id"], unique=False)
    op.create_index("ix_approvals_assignment_id", "approvals", ["assignment_id"], unique=False)
    op.create_index("ix_approvals_entity_id", "approvals", ["entity_id"], unique=False)
    op.create_index("ix_approvals_entity_type", "approvals", ["entity_type"], unique=False)

    op.create_table(
        "leave_requests",
        sa.Column("requester_user_id", sa.Integer(), nullable=False),
        sa.Column("leave_type", leave_type_enum, nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("hours", sa.Float(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("status", leave_status_enum, nullable=False, server_default="PENDING"),
        sa.Column("approver_user_id", sa.Integer(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("calendar_event_id", sa.Integer(), nullable=True),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["approver_user_id"], ["users.id"], name="fk_leave_requests_approver_user_id_users"),
        sa.ForeignKeyConstraint(["calendar_event_id"], ["calendar_events.id"], name="fk_leave_requests_calendar_event_id_calendar_events"),
        sa.ForeignKeyConstraint(["requester_user_id"], ["users.id"], name="fk_leave_requests_requester_user_id_users"),
    )
    op.create_index("ix_leave_requests_approver_user_id", "leave_requests", ["approver_user_id"], unique=False)
    op.create_index("ix_leave_requests_start_date", "leave_requests", ["start_date"], unique=False)
    op.create_index("ix_leave_requests_status", "leave_requests", ["status"], unique=False)

    op.create_table(
        "notifications",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("type", notification_type_enum, nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payload_json", sa.JSON(), nullable=True),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_notifications_user_id_users", ondelete="CASCADE"),
    )
    op.create_index("ix_notifications_read_at", "notifications", ["read_at"], unique=False)
    op.create_index("ix_notifications_type", "notifications", ["type"], unique=False)
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"], unique=False)

    op.create_table(
        "activity_logs",
        sa.Column("assignment_id", sa.Integer(), nullable=True),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("type", sa.String(length=100), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("payload_json", sa.JSON(), nullable=True),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], name="fk_activity_logs_actor_user_id_users"),
        sa.ForeignKeyConstraint(
            ["assignment_id"],
            ["assignments.id"],
            name="fk_activity_logs_assignment_id_assignments",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_activity_logs_assignment_id", "activity_logs", ["assignment_id"], unique=False)
    op.create_index("ix_activity_logs_type", "activity_logs", ["type"], unique=False)

    op.create_table(
        "invoices",
        sa.Column("assignment_id", sa.Integer(), nullable=False),
        sa.Column("invoice_number", sa.String(length=100), nullable=False),
        sa.Column("issued_date", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("status", invoice_status_enum, nullable=False, server_default="DRAFT"),
        sa.Column("subtotal", sa.Numeric(12, 2), nullable=False, server_default="0.00"),
        sa.Column("tax_rate", sa.Numeric(5, 2), nullable=False, server_default="0.00"),
        sa.Column("tax_amount", sa.Numeric(12, 2), nullable=False, server_default="0.00"),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False, server_default="0.00"),
        sa.Column("is_paid", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("company_account_id", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["assignment_id"],
            ["assignments.id"],
            name="fk_invoices_assignment_id_assignments",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["company_account_id"], ["company_accounts.id"], name="fk_invoices_company_account_id_company_accounts"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], name="fk_invoices_created_by_user_id_users"),
        sa.UniqueConstraint("invoice_number", name="uq_invoices_invoice_number"),
    )
    op.create_index("ix_invoices_assignment_id", "invoices", ["assignment_id"], unique=False)
    op.create_index("ix_invoices_invoice_number", "invoices", ["invoice_number"], unique=False)
    op.create_index("ix_invoices_is_paid", "invoices", ["is_paid"], unique=False)
    op.create_index("ix_invoices_issued_date", "invoices", ["issued_date"], unique=False)
    op.create_index("ix_invoices_status", "invoices", ["status"], unique=False)

    op.create_table(
        "invoice_items",
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 2), nullable=False, server_default="1.00"),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False, server_default="0.00"),
        sa.Column("line_total", sa.Numeric(12, 2), nullable=False, server_default="0.00"),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["invoice_id"],
            ["invoices.id"],
            name="fk_invoice_items_invoice_id_invoices",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_invoice_items_invoice_id", "invoice_items", ["invoice_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_invoice_items_invoice_id", table_name="invoice_items")
    op.drop_table("invoice_items")

    op.drop_index("ix_invoices_status", table_name="invoices")
    op.drop_index("ix_invoices_issued_date", table_name="invoices")
    op.drop_index("ix_invoices_is_paid", table_name="invoices")
    op.drop_index("ix_invoices_invoice_number", table_name="invoices")
    op.drop_index("ix_invoices_assignment_id", table_name="invoices")
    op.drop_table("invoices")

    op.drop_index("ix_activity_logs_type", table_name="activity_logs")
    op.drop_index("ix_activity_logs_assignment_id", table_name="activity_logs")
    op.drop_table("activity_logs")

    op.drop_index("ix_notifications_user_id", table_name="notifications")
    op.drop_index("ix_notifications_type", table_name="notifications")
    op.drop_index("ix_notifications_read_at", table_name="notifications")
    op.drop_table("notifications")

    op.drop_index("ix_leave_requests_status", table_name="leave_requests")
    op.drop_index("ix_leave_requests_start_date", table_name="leave_requests")
    op.drop_index("ix_leave_requests_approver_user_id", table_name="leave_requests")
    op.drop_table("leave_requests")

    op.drop_index("ix_approvals_entity_type", table_name="approvals")
    op.drop_index("ix_approvals_entity_id", table_name="approvals")
    op.drop_index("ix_approvals_assignment_id", table_name="approvals")
    op.drop_index("ix_approvals_approver_user_id", table_name="approvals")
    op.drop_index("ix_approvals_action_type", table_name="approvals")
    op.drop_table("approvals")

    op.drop_index("ix_assignment_tasks_status", table_name="assignment_tasks")
    op.drop_index("ix_assignment_tasks_due_at", table_name="assignment_tasks")
    op.drop_index("ix_assignment_tasks_assigned_to_user_id", table_name="assignment_tasks")
    op.drop_index("ix_assignment_tasks_assignment_id", table_name="assignment_tasks")
    op.drop_table("assignment_tasks")

    op.drop_index("ix_assignment_messages_pinned", table_name="assignment_messages")
    op.drop_index("ix_assignment_messages_assignment_id", table_name="assignment_messages")
    op.drop_table("assignment_messages")

    op.drop_index("ix_assignment_documents_category", table_name="assignment_documents")
    op.drop_index("ix_assignment_documents_assignment_id", table_name="assignment_documents")
    op.drop_table("assignment_documents")

    op.drop_index("ix_calendar_events_start_at", table_name="calendar_events")
    op.drop_index("ix_calendar_events_event_type", table_name="calendar_events")
    op.drop_index("ix_calendar_events_end_at", table_name="calendar_events")
    op.drop_index("ix_calendar_events_assigned_to_user_id", table_name="calendar_events")
    op.drop_index("ix_calendar_events_assignment_id", table_name="calendar_events")
    op.drop_table("calendar_events")

    op.drop_index("ix_assignments_status", table_name="assignments")
    op.drop_index("ix_assignments_site_visit_date", table_name="assignments")
    op.drop_index("ix_assignments_report_due_date", table_name="assignments")
    op.drop_index("ix_assignments_property_type_id", table_name="assignments")
    op.drop_index("ix_assignments_is_paid", table_name="assignments")
    op.drop_index("ix_assignments_is_deleted", table_name="assignments")
    op.drop_index("ix_assignments_created_by_user_id", table_name="assignments")
    op.drop_index("ix_assignments_client_id", table_name="assignments")
    op.drop_index("ix_assignments_case_type", table_name="assignments")
    op.drop_index("ix_assignments_borrower_name", table_name="assignments")
    op.drop_index("ix_assignments_branch_id", table_name="assignments")
    op.drop_index("ix_assignments_bank_id", table_name="assignments")
    op.drop_index("ix_assignments_assigned_to_user_id", table_name="assignments")
    op.drop_index("ix_assignments_assignment_code", table_name="assignments")
    op.drop_table("assignments")

    op.drop_index("ix_document_checklist_templates_category", table_name="document_checklist_templates")
    op.drop_table("document_checklist_templates")

    op.drop_table("company_accounts")

    op.drop_index("ix_branches_name", table_name="branches")
    op.drop_index("ix_branches_bank_id", table_name="branches")
    op.drop_table("branches")

    op.drop_index("ix_users_role", table_name="users")
    op.drop_index("ix_users_is_active", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")

    op.drop_index("ix_property_types_name", table_name="property_types")
    op.drop_table("property_types")

    op.drop_index("ix_clients_name", table_name="clients")
    op.drop_table("clients")

    op.drop_index("ix_banks_name", table_name="banks")
    op.drop_table("banks")

    bind = op.get_bind()
    invoice_status_enum.drop(bind, checkfirst=True)
    notification_type_enum.drop(bind, checkfirst=True)
    calendar_event_type_enum.drop(bind, checkfirst=True)
    leave_status_enum.drop(bind, checkfirst=True)
    leave_type_enum.drop(bind, checkfirst=True)
    approval_action_type_enum.drop(bind, checkfirst=True)
    approval_entity_type_enum.drop(bind, checkfirst=True)
    approval_status_enum.drop(bind, checkfirst=True)
    task_status_enum.drop(bind, checkfirst=True)
    assignment_status_enum.drop(bind, checkfirst=True)
    case_type_enum.drop(bind, checkfirst=True)
    role_enum.drop(bind, checkfirst=True)
