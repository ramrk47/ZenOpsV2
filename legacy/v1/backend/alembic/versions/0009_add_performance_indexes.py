"""Add performance indexes for analytics and invoices.

Revision ID: 0009_add_performance_indexes
Revises: 0008_invoice_followups_and_idempotency
Create Date: 2026-02-05
"""

from __future__ import annotations

from alembic import op

revision = "0009_add_performance_indexes"
down_revision = "0008_invoice_followups_and_idempotency"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_assignments_bank_created", "assignments", ["bank_id", "created_at"], unique=False)
    op.create_index("ix_assignments_branch_created", "assignments", ["branch_id", "created_at"], unique=False)
    op.create_index("ix_assignments_case_created", "assignments", ["case_type", "created_at"], unique=False)
    op.create_index("ix_assignments_service_created", "assignments", ["service_line", "created_at"], unique=False)
    op.create_index("ix_assignments_status_created", "assignments", ["status", "created_at"], unique=False)

    op.create_index("ix_invoices_due_paid", "invoices", ["due_date", "is_paid"], unique=False)
    op.create_index("ix_invoices_assignment_issued", "invoices", ["assignment_id", "issued_date"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_invoices_assignment_issued", table_name="invoices")
    op.drop_index("ix_invoices_due_paid", table_name="invoices")
    op.drop_index("ix_assignments_status_created", table_name="assignments")
    op.drop_index("ix_assignments_service_created", table_name="assignments")
    op.drop_index("ix_assignments_case_created", table_name="assignments")
    op.drop_index("ix_assignments_branch_created", table_name="assignments")
    op.drop_index("ix_assignments_bank_created", table_name="assignments")
