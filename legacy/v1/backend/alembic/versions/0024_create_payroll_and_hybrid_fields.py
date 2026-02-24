"""Create payroll tables with hybrid payroll fields.

Revision ID: 0024_create_payroll_and_hybrid_fields
Revises: 0023_add_whatsapp_fields
Create Date: 2026-02-07
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0024_create_payroll_and_hybrid_fields"
down_revision = "0023_add_whatsapp_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create salary_structures table
    op.create_table(
        "salary_structures",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("monthly_ctc", sa.Numeric(12, 2), nullable=True),
        sa.Column("currency", sa.String(10), nullable=False, server_default="INR"),
        sa.Column("earnings", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("pf_enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("pf_employee_rate", sa.Numeric(5, 2), nullable=True),
        sa.Column("pf_employer_rate", sa.Numeric(5, 2), nullable=True),
        sa.Column("esi_enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("esi_employee_rate", sa.Numeric(5, 2), nullable=True),
        sa.Column("esi_employer_rate", sa.Numeric(5, 2), nullable=True),
        sa.Column("pt_enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("pt_monthly_amount", sa.Numeric(10, 2), nullable=True),
        sa.Column("tds_mode", sa.String(20), nullable=False, server_default="MANUAL"),
        sa.Column("tds_monthly_amount", sa.Numeric(10, 2), nullable=True),
        sa.Column("bank_account_number", sa.String(50), nullable=True),
        sa.Column("bank_ifsc", sa.String(20), nullable=True),
        sa.Column("bank_beneficiary_name", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true", index=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_salary_structures_user_id", "salary_structures", ["user_id"])
    op.create_index("ix_salary_structures_effective_from", "salary_structures", ["effective_from"])
    op.create_index("ix_salary_structures_effective_to", "salary_structures", ["effective_to"])

    # Create payroll_runs table
    op.create_table(
        "payroll_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("month", sa.String(7), nullable=False, unique=True, index=True, comment="YYYY-MM format"),
        sa.Column("year", sa.Integer(), nullable=False, index=True),
        sa.Column("month_num", sa.Integer(), nullable=False, index=True),
        sa.Column("status", sa.Enum("DRAFT", "TIME_PENDING", "READY_TO_CALCULATE", "CALCULATED", "APPROVED", "PAID", "LOCKED", name="payroll_run_status"), nullable=False, server_default="DRAFT", index=True),
        sa.Column("created_by", sa.Integer(), nullable=False, index=True),
        sa.Column("calculated_by", sa.Integer(), nullable=True),
        sa.Column("calculated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", sa.Integer(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_by", sa.Integer(), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("locked_by", sa.Integer(), nullable=True),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("config_snapshot", postgresql.JSONB(), nullable=False, server_default="{}", comment="Snapshot of payroll policy at time of calculation"),
        sa.Column("employee_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_gross", sa.Numeric(14, 2), nullable=False, server_default="0.0"),
        sa.Column("total_deductions", sa.Numeric(14, 2), nullable=False, server_default="0.0"),
        sa.Column("total_net", sa.Numeric(14, 2), nullable=False, server_default="0.0"),
        sa.Column("total_pf_employee", sa.Numeric(12, 2), nullable=False, server_default="0.0"),
        sa.Column("total_pf_employer", sa.Numeric(12, 2), nullable=False, server_default="0.0"),
        sa.Column("total_esi_employee", sa.Numeric(12, 2), nullable=False, server_default="0.0"),
        sa.Column("total_esi_employer", sa.Numeric(12, 2), nullable=False, server_default="0.0"),
        sa.Column("total_pt", sa.Numeric(12, 2), nullable=False, server_default="0.0"),
        sa.Column("total_tds", sa.Numeric(12, 2), nullable=False, server_default="0.0"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("exception_count", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["calculated_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["approved_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["paid_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["locked_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # Create payroll_line_items table
    op.create_table(
        "payroll_line_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payroll_run_id", sa.Integer(), nullable=False, index=True),
        sa.Column("user_id", sa.Integer(), nullable=False, index=True),
        sa.Column("salary_structure_id", sa.Integer(), nullable=False, index=True, comment="Reference to salary structure used for this payroll"),
        sa.Column("days_payable", sa.Numeric(5, 2), nullable=False, server_default="0.0"),
        sa.Column("days_lop", sa.Numeric(5, 2), nullable=False, server_default="0.0"),
        sa.Column("days_present", sa.Numeric(5, 2), nullable=False, server_default="0.0"),
        sa.Column("days_absent", sa.Numeric(5, 2), nullable=False, server_default="0.0"),
        sa.Column("days_leave_paid", sa.Numeric(5, 2), nullable=False, server_default="0.0"),
        sa.Column("days_leave_unpaid", sa.Numeric(5, 2), nullable=False, server_default="0.0"),
        sa.Column("total_minutes_worked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("overtime_minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("late_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("late_minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("base_monthly_salary", sa.Numeric(12, 2), nullable=False, server_default="0.0", comment="monthly_gross from salary structure"),
        sa.Column("daily_rate", sa.Numeric(10, 2), nullable=False, server_default="0.0", comment="daily_rate = base_monthly / divisor_days"),
        sa.Column("base_pay", sa.Numeric(12, 2), nullable=False, server_default="0.0", comment="base_pay = daily_rate * days_payable (fixed monthly component)"),
        sa.Column("overtime_pay", sa.Numeric(12, 2), nullable=False, server_default="0.0", comment="overtime_pay = (total_overtime_minutes / 60) * overtime_rate"),
        sa.Column("overtime_approved", sa.Boolean(), nullable=False, server_default="false", comment="Only pay overtime if approved"),
        sa.Column("gross_pay", sa.Numeric(12, 2), nullable=False, server_default="0.0", comment="gross_pay = base_pay + overtime_pay"),
        sa.Column("pf_employee", sa.Numeric(10, 2), nullable=False, server_default="0.0"),
        sa.Column("pf_employer", sa.Numeric(10, 2), nullable=False, server_default="0.0"),
        sa.Column("esi_employee", sa.Numeric(10, 2), nullable=False, server_default="0.0"),
        sa.Column("esi_employer", sa.Numeric(10, 2), nullable=False, server_default="0.0"),
        sa.Column("pt", sa.Numeric(10, 2), nullable=False, server_default="0.0"),
        sa.Column("tds", sa.Numeric(10, 2), nullable=False, server_default="0.0"),
        sa.Column("other_deductions", sa.Numeric(10, 2), nullable=False, server_default="0.0"),
        sa.Column("deductions_total", sa.Numeric(12, 2), nullable=False, server_default="0.0"),
        sa.Column("net_pay", sa.Numeric(12, 2), nullable=False, server_default="0.0"),
        sa.Column("breakdown_json", postgresql.JSONB(), nullable=False, server_default="{}", comment="Full component breakdown: {earnings: {...}, deductions: {...}, adjustments: [...]}"),
        sa.Column("has_exceptions", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("exception_details", sa.Text(), nullable=True),
        sa.Column("override_applied", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("override_reason", sa.Text(), nullable=True),
        sa.Column("override_by", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["payroll_run_id"], ["payroll_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["salary_structure_id"], ["salary_structures.id"]),
        sa.ForeignKeyConstraint(["override_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("payroll_run_id", "user_id", name="uq_payroll_run_user"),
    )

    # Create payslips table
    op.create_table(
        "payslips",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payroll_run_id", sa.Integer(), nullable=False, index=True),
        sa.Column("user_id", sa.Integer(), nullable=False, index=True),
        sa.Column("payslip_number", sa.String(50), nullable=False, unique=True, index=True, comment="e.g., PS-202601-001"),
        sa.Column("pdf_path", sa.String(500), nullable=True),
        sa.Column("html_content", sa.String(), nullable=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("generated_by", sa.Integer(), nullable=False),
        sa.Column("email_sent", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("email_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("email_delivery_id", sa.Integer(), nullable=True),
        sa.Column("downloaded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("download_count", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["payroll_run_id"], ["payroll_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["generated_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["email_delivery_id"], ["notification_deliveries.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("payroll_run_id", "user_id", name="uq_payslip_run_user"),
    )


def downgrade() -> None:
    op.drop_table("payslips")
    op.drop_table("payroll_line_items")
    op.drop_table("payroll_runs")
    op.drop_table("salary_structures")
