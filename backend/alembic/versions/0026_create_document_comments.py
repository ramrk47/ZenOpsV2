"""create document comments table

Revision ID: 0026_create_document_comments
Revises: 0025_add_hybrid_payroll_fields
Create Date: 2026-02-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0026_create_document_comments'
down_revision: Union[str, None] = '0025_add_hybrid_payroll_fields'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'document_comments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('document_id', sa.Integer(), nullable=False),
        sa.Column('assignment_id', sa.Integer(), nullable=False),
        sa.Column('author_id', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('lane', sa.Enum('INTERNAL', 'EXTERNAL', name='commentlane'), nullable=False),
        sa.Column('parent_comment_id', sa.Integer(), nullable=True),
        sa.Column('thread_depth', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('mentioned_user_ids', sa.String(500), nullable=True),
        sa.Column('is_resolved', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('resolved_at', sa.DateTime(), nullable=True),
        sa.Column('resolved_by_id', sa.Integer(), nullable=True),
        sa.Column('is_visible_to_client', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('is_edited', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('edited_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['assignment_id'], ['assignments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['author_id'], ['users.id']),
        sa.ForeignKeyConstraint(['document_id'], ['assignment_documents.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['parent_comment_id'], ['document_comments.id']),
        sa.ForeignKeyConstraint(['resolved_by_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_document_comments_assignment_id'), 'document_comments', ['assignment_id'], unique=False)
    op.create_index(op.f('ix_document_comments_author_id'), 'document_comments', ['author_id'], unique=False)
    op.create_index(op.f('ix_document_comments_document_id'), 'document_comments', ['document_id'], unique=False)
    op.create_index(op.f('ix_document_comments_lane'), 'document_comments', ['lane'], unique=False)
    op.create_index(op.f('ix_document_comments_parent_comment_id'), 'document_comments', ['parent_comment_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_document_comments_parent_comment_id'), table_name='document_comments')
    op.drop_index(op.f('ix_document_comments_lane'), table_name='document_comments')
    op.drop_index(op.f('ix_document_comments_document_id'), table_name='document_comments')
    op.drop_index(op.f('ix_document_comments_author_id'), table_name='document_comments')
    op.drop_index(op.f('ix_document_comments_assignment_id'), table_name='document_comments')
    op.drop_table('document_comments')
    op.execute('DROP TYPE commentlane')
