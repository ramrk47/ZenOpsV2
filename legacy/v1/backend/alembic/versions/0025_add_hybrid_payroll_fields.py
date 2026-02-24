"""Add hybrid payroll fields to salary_structures.

Revision ID: 0025_add_hybrid_payroll_fields
Revises: 0024_create_payroll_and_hybrid_fields
Create Date: 2026-02-07
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0025_add_hybrid_payroll_fields"
down_revision = "0024_create_payroll_and_hybrid_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add hybrid payroll fields to salary_structures
    op.add_column(
        "salary_structures",
        sa.Column("monthly_gross", sa.Numeric(12, 2), nullable=True, comment="Monthly base salary for pro-rata calculation")
    )
    op.add_column(
        "salary_structures",
        sa.Column("standard_minutes_per_day", sa.Integer(), nullable=False, server_default="480", comment="Standard work minutes per day (default 480 = 8 hours)")
    )
    op.add_column(
        "salary_structures",
        sa.Column("payroll_divisor_days", sa.Integer(), nullable=False, server_default="30", comment="Days used to divide monthly salary (default 30)")
    )
    op.add_column(
        "salary_structures",
        sa.Column("overtime_multiplier", sa.Numeric(3, 1), nullable=False, server_default="2.0", comment="Multiplier for overtime rate (default 2.0x)")
    )
    op.add_column(
        "salary_structures",
        sa.Column("overtime_requires_approval", sa.Boolean(), nullable=False, server_default="true", comment="Whether overtime must be approved before payment")
    )


def downgrade() -> None:
    # Remove hybrid payroll fields from salary_structures
    op.drop_column("salary_structures", "overtime_requires_approval")
    op.drop_column("salary_structures", "overtime_multiplier")
    op.drop_column("salary_structures", "payroll_divisor_days")
    op.drop_column("salary_structures", "standard_minutes_per_day")
    op.drop_column("salary_structures", "monthly_gross")
