"""Add India-style payroll policy fields (weekly_off, holidays, annual_leave)

Revision ID: 0027_add_payroll_policy_fields
Revises: 0026_create_document_comments
Create Date: 2026-02-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0027_add_payroll_policy_fields'
down_revision: Union[str, None] = '0026_create_document_comments'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Check if payroll_policies table exists before trying to alter it
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    if 'payroll_policies' not in inspector.get_table_names():
        # Table doesn't exist yet, skip this migration
        # (Likely the table will be created with all fields in a later migration)
        return
    
    # Check if columns already exist
    existing_columns = [col['name'] for col in inspector.get_columns('payroll_policies')]
    
    # Add new columns to payroll_policies table only if they don't exist
    if 'weekly_off_day' not in existing_columns:
        op.add_column(
            'payroll_policies',
            sa.Column('weekly_off_day', sa.Integer(), nullable=False, server_default='6',
                      comment='0=Mon, 5=Sat, 6=Sun')
        )
        # Remove server default after adding column
        op.alter_column('payroll_policies', 'weekly_off_day',
                        existing_type=sa.Integer(),
                        server_default=None)
    
    if 'annual_paid_leave_quota' not in existing_columns:
        op.add_column(
            'payroll_policies',
            sa.Column('annual_paid_leave_quota', sa.Integer(), nullable=False, server_default='21',
                      comment='Annual leave days per employee')
        )
        # Remove server default after adding column
        op.alter_column('payroll_policies', 'annual_paid_leave_quota',
                        existing_type=sa.Integer(),
                        server_default=None)
    
    if 'company_holidays' not in existing_columns:
        op.add_column(
            'payroll_policies',
            sa.Column('company_holidays', sa.dialects.postgresql.JSONB(), nullable=True,
                      comment='List of company holidays: [{date: YYYY-MM-DD, name: str, paid: bool}]')
        )


def downgrade() -> None:
    # Check if payroll_policies table exists
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    if 'payroll_policies' not in inspector.get_table_names():
        return
    
    existing_columns = [col['name'] for col in inspector.get_columns('payroll_policies')]
    
    if 'company_holidays' in existing_columns:
        op.drop_column('payroll_policies', 'company_holidays')
    if 'annual_paid_leave_quota' in existing_columns:
        op.drop_column('payroll_policies', 'annual_paid_leave_quota')
    if 'weekly_off_day' in existing_columns:
        op.drop_column('payroll_policies', 'weekly_off_day')
