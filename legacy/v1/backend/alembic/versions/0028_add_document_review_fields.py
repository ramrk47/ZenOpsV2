"""add document review fields

Revision ID: 0028_add_document_review_fields
Revises: 0027_add_payroll_policy_fields
Create Date: 2026-02-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0028_add_document_review_fields'
down_revision: Union[str, None] = '0027_add_payroll_policy_fields'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create enums
    op.execute("""
        CREATE TYPE documentreviewstatus AS ENUM (
            'UPLOADED', 'RECEIVED', 'REVIEWED', 'NEEDS_CLARIFICATION', 'REJECTED', 'FINAL'
        )
    """)
    op.execute("""
        CREATE TYPE documentvisibility AS ENUM (
            'INTERNAL_ONLY', 'PARTNER_RELEASED'
        )
    """)
    
    # Add columns to assignment_documents
    op.add_column('assignment_documents', sa.Column(
        'review_status',
        sa.Enum('UPLOADED', 'RECEIVED', 'REVIEWED', 'NEEDS_CLARIFICATION', 'REJECTED', 'FINAL', name='documentreviewstatus'),
        nullable=False,
        server_default='RECEIVED'
    ))
    op.add_column('assignment_documents', sa.Column(
        'visibility',
        sa.Enum('INTERNAL_ONLY', 'PARTNER_RELEASED', name='documentvisibility'),
        nullable=False,
        server_default='INTERNAL_ONLY'
    ))
    op.add_column('assignment_documents', sa.Column(
        'reviewed_by_user_id',
        sa.Integer(),
        nullable=True
    ))
    op.add_column('assignment_documents', sa.Column(
        'reviewed_at',
        sa.DateTime(),
        nullable=True
    ))
    
    # Add foreign key for reviewed_by_user_id
    op.create_foreign_key(
        'fk_assignment_documents_reviewed_by_user_id',
        'assignment_documents',
        'users',
        ['reviewed_by_user_id'],
        ['id']
    )
    
    # Add index for review_status
    op.create_index(
        op.f('ix_assignment_documents_review_status'),
        'assignment_documents',
        ['review_status'],
        unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_assignment_documents_review_status'), table_name='assignment_documents')
    op.drop_constraint('fk_assignment_documents_reviewed_by_user_id', 'assignment_documents', type_='foreignkey')
    op.drop_column('assignment_documents', 'reviewed_at')
    op.drop_column('assignment_documents', 'reviewed_by_user_id')
    op.drop_column('assignment_documents', 'visibility')
    op.drop_column('assignment_documents', 'review_status')
    op.execute('DROP TYPE documentvisibility')
    op.execute('DROP TYPE documentreviewstatus')
