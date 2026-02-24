"""fix reviewed_by_user_id type from uuid to integer

Revision ID: 0033_fix_reviewed_by_user_id_type
Revises: 0032_add_support_system
Create Date: 2026-02-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0033_fix_reviewed_by_user_id_type'
down_revision: Union[str, None] = '0032_add_support_system'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop the foreign key if it exists
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.table_constraints 
                       WHERE constraint_name = 'fk_assignment_documents_reviewed_by_user_id') THEN
                ALTER TABLE assignment_documents DROP CONSTRAINT fk_assignment_documents_reviewed_by_user_id;
            END IF;
        END $$;
    """)
    
    # Change column type from uuid to integer
    # First drop the column and recreate it (since no data exists)
    op.execute("""
        ALTER TABLE assignment_documents 
        DROP COLUMN IF EXISTS reviewed_by_user_id;
    """)
    
    op.add_column('assignment_documents', sa.Column(
        'reviewed_by_user_id',
        sa.Integer(),
        nullable=True
    ))
    
    # Recreate foreign key
    op.create_foreign_key(
        'fk_assignment_documents_reviewed_by_user_id',
        'assignment_documents',
        'users',
        ['reviewed_by_user_id'],
        ['id']
    )


def downgrade() -> None:
    # Drop foreign key
    op.drop_constraint('fk_assignment_documents_reviewed_by_user_id', 'assignment_documents', type_='foreignkey')
    
    # Drop the integer column
    op.drop_column('assignment_documents', 'reviewed_by_user_id')
    
    # Recreate as uuid (original incorrect type)
    op.add_column('assignment_documents', sa.Column(
        'reviewed_by_user_id',
        sa.dialects.postgresql.UUID(),
        nullable=True
    ))
