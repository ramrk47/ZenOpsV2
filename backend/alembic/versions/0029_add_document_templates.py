"""add document templates

Revision ID: 0029_add_document_templates
Revises: 0028_add_document_review_fields
Create Date: 2026-02-08 13:15:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '0029_add_document_templates'
down_revision = '0026_create_document_comments'
branch_labels = None
depends_on = None


def upgrade():
    # Create document_templates table
    op.create_table(
        'document_templates',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('category', sa.String(100), nullable=True),
        
        # Scoping
        sa.Column('client_id', sa.Integer(), nullable=True),
        sa.Column('service_line', sa.String(100), nullable=True),
        sa.Column('property_type_id', sa.Integer(), nullable=True),
        
        # File info
        sa.Column('storage_path', sa.String(500), nullable=False),
        sa.Column('original_name', sa.String(255), nullable=False),
        sa.Column('mime_type', sa.String(100), nullable=True),
        sa.Column('size', sa.BigInteger(), nullable=True),
        
        # Metadata
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('display_order', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('created_by_user_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        
        sa.ForeignKeyConstraint(['client_id'], ['clients.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['property_type_id'], ['property_types.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='SET NULL'),
    )
    
    # Create indexes
    op.create_index('ix_document_templates_client_id', 'document_templates', ['client_id'])
    op.create_index('ix_document_templates_service_line', 'document_templates', ['service_line'])
    op.create_index('ix_document_templates_property_type_id', 'document_templates', ['property_type_id'])
    op.create_index('ix_document_templates_is_active', 'document_templates', ['is_active'])


def downgrade():
    op.drop_index('ix_document_templates_is_active', 'document_templates')
    op.drop_index('ix_document_templates_property_type_id', 'document_templates')
    op.drop_index('ix_document_templates_service_line', 'document_templates')
    op.drop_index('ix_document_templates_client_id', 'document_templates')
    op.drop_table('document_templates')
