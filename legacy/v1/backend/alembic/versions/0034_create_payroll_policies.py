"""Create payroll_policies table

Revision ID: 0034_create_payroll_policies
Revises: 0033_fix_reviewed_by_user_id_type
Create Date: 2026-02-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0034_create_payroll_policies'
down_revision: Union[str, None] = '0033_fix_reviewed_by_user_id_type'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    if 'payroll_policies' in inspector.get_table_names():
        return  # Already exists
    
    op.create_table(
        'payroll_policies',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        
        # Pay cycle configuration
        sa.Column('monthly_pay_days', sa.Integer(), nullable=False, server_default='30'),
        sa.Column('full_day_minimum_minutes', sa.Integer(), nullable=False, server_default='480'),
        sa.Column('half_day_threshold_minutes', sa.Integer(), nullable=False, server_default='240'),
        sa.Column('grace_period_minutes', sa.Integer(), nullable=False, server_default='15'),
        
        # LOP rules
        sa.Column('lop_on_absent', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('lop_on_unapproved_leave', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('lop_on_late_threshold_count', sa.Integer(), nullable=True),
        
        # Overtime configuration
        sa.Column('overtime_enabled', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('overtime_multiplier', sa.Numeric(5, 2), nullable=True, server_default='1.5'),
        sa.Column('overtime_requires_approval', sa.Boolean(), nullable=False, server_default='true'),
        
        # Statutory defaults - PF
        sa.Column('pf_enabled_default', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('pf_employee_rate', sa.Numeric(5, 2), nullable=False, server_default='12.0'),
        sa.Column('pf_employer_rate', sa.Numeric(5, 2), nullable=False, server_default='12.0'),
        sa.Column('pf_wage_ceiling', sa.Numeric(10, 2), nullable=True, server_default='15000.0'),
        
        # Statutory defaults - ESI
        sa.Column('esi_enabled_default', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('esi_employee_rate', sa.Numeric(5, 2), nullable=False, server_default='0.75'),
        sa.Column('esi_employer_rate', sa.Numeric(5, 2), nullable=False, server_default='3.25'),
        sa.Column('esi_wage_ceiling', sa.Numeric(10, 2), nullable=True, server_default='21000.0'),
        
        # Statutory defaults - PT
        sa.Column('pt_enabled_default', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('pt_monthly_amount', sa.Numeric(10, 2), nullable=True, server_default='200.0'),
        
        # TDS
        sa.Column('tds_enabled_default', sa.Boolean(), nullable=False, server_default='true'),
        
        # Leave impact rules (JSONB)
        sa.Column('leave_type_impacts', postgresql.JSONB(), nullable=True),
        
        # Weekly off & holidays
        sa.Column('weekly_off_day', sa.Integer(), nullable=False, server_default='6'),
        sa.Column('annual_paid_leave_quota', sa.Integer(), nullable=False, server_default='21'),
        sa.Column('company_holidays', postgresql.JSONB(), nullable=True),
        
        # Policy metadata
        sa.Column('policy_name', sa.String(255), nullable=False, server_default="'Default Payroll Policy'"),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        
        sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('payroll_policies')
