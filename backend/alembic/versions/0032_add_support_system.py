"""add support system tables

Revision ID: 0032_add_support_system
Revises: 0031_merge_document_template_heads
Create Date: 2026-02-09 16:40:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '0032_add_support_system'
down_revision = '0031_merge_document_template_heads'
branch_labels = None
depends_on = None


def upgrade():
    # Create enum types
    op.execute("""
        CREATE TYPE support_thread_status AS ENUM ('OPEN', 'PENDING', 'RESOLVED', 'CLOSED');
    """)
    op.execute("""
        CREATE TYPE support_priority AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
    """)
    op.execute("""
        CREATE TYPE author_type AS ENUM ('INTERNAL', 'EXTERNAL');
    """)

    # Create support_threads table
    op.create_table(
        'support_threads',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('assignment_id', sa.Integer(), nullable=True),
        sa.Column('created_by_user_id', sa.Integer(), nullable=False),
        sa.Column('created_via', postgresql.ENUM('INTERNAL', 'EXTERNAL', name='author_type', create_type=False), nullable=False, server_default='INTERNAL'),
        sa.Column('status', postgresql.ENUM('OPEN', 'PENDING', 'RESOLVED', 'CLOSED', name='support_thread_status', create_type=False), nullable=False, server_default='OPEN'),
        sa.Column('priority', postgresql.ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT', name='support_priority', create_type=False), nullable=False, server_default='MEDIUM'),
        sa.Column('subject', sa.String(500), nullable=False),
        sa.Column('last_message_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        
        sa.ForeignKeyConstraint(['assignment_id'], ['assignments.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='CASCADE'),
    )
    
    # Create indexes for support_threads
    op.create_index('ix_support_threads_assignment_id', 'support_threads', ['assignment_id'])
    op.create_index('ix_support_threads_created_by_user_id', 'support_threads', ['created_by_user_id'])
    op.create_index('ix_support_threads_status', 'support_threads', ['status'])
    op.create_index('ix_support_threads_priority', 'support_threads', ['priority'])
    op.create_index('ix_support_threads_last_message_at', 'support_threads', ['last_message_at'])

    # Create support_messages table
    op.create_table(
        'support_messages',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('thread_id', sa.Integer(), nullable=False),
        sa.Column('author_user_id', sa.Integer(), nullable=True),
        sa.Column('author_type', postgresql.ENUM('INTERNAL', 'EXTERNAL', name='author_type', create_type=False), nullable=False),
        sa.Column('author_label', sa.String(255), nullable=True),
        sa.Column('message_text', sa.Text(), nullable=False),
        sa.Column('attachments_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('message_metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        
        sa.ForeignKeyConstraint(['thread_id'], ['support_threads.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['author_user_id'], ['users.id'], ondelete='SET NULL'),
    )
    
    # Create indexes for support_messages
    op.create_index('ix_support_messages_thread_id', 'support_messages', ['thread_id'])
    op.create_index('ix_support_messages_author_user_id', 'support_messages', ['author_user_id'])

    # Create support_tokens table
    op.create_table(
        'support_tokens',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('token_hash', sa.String(255), nullable=False, unique=True),
        sa.Column('assignment_id', sa.Integer(), nullable=True),
        sa.Column('thread_id', sa.Integer(), nullable=True),
        sa.Column('created_by_user_id', sa.Integer(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('used_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        
        sa.ForeignKeyConstraint(['assignment_id'], ['assignments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['thread_id'], ['support_threads.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='CASCADE'),
    )
    
    # Create indexes for support_tokens
    op.create_index('ix_support_tokens_token_hash', 'support_tokens', ['token_hash'], unique=True)
    op.create_index('ix_support_tokens_expires_at', 'support_tokens', ['expires_at'])

    # Create email_delivery_logs table
    op.create_table(
        'email_delivery_logs',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('event_type', sa.String(100), nullable=False),
        sa.Column('idempotency_key', sa.String(255), nullable=False, unique=True),
        sa.Column('to_email', sa.String(255), nullable=False),
        sa.Column('subject', sa.String(500), nullable=False),
        sa.Column('status', sa.String(50), nullable=False, server_default='QUEUED'),
        sa.Column('provider', sa.String(50), nullable=False, server_default='resend'),
        sa.Column('provider_message_id', sa.String(255), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('payload_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    
    # Create indexes for email_delivery_logs
    op.create_index('ix_email_delivery_logs_event_type', 'email_delivery_logs', ['event_type'])
    op.create_index('ix_email_delivery_logs_idempotency_key', 'email_delivery_logs', ['idempotency_key'], unique=True)
    op.create_index('ix_email_delivery_logs_to_email', 'email_delivery_logs', ['to_email'])
    op.create_index('ix_email_delivery_logs_status', 'email_delivery_logs', ['status'])

    # Create system_config table
    op.create_table(
        'system_config',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('config_key', sa.String(100), nullable=False, unique=True),
        sa.Column('config_value', sa.Text(), nullable=True),
        sa.Column('config_type', sa.String(50), nullable=False, server_default='STRING'),
        sa.Column('is_public', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    
    # Create index for system_config
    op.create_index('ix_system_config_config_key', 'system_config', ['config_key'], unique=True)

    # Insert default system config values (non-secrets only)
    op.execute("""
        INSERT INTO system_config (config_key, config_value, config_type, is_public, description)
        VALUES
        ('WHATSAPP_NUMBER', '917975357599', 'STRING', true, 'WhatsApp click-to-chat number (digits only)'),
        ('OPS_SUPPORT_EMAIL', '', 'STRING', false, 'Ops team support email'),
        ('SUPPORT_BUBBLE_ENABLED', 'true', 'BOOL', true, 'Enable WhatsApp support bubble on external portal'),
        ('SUPPORT_PORTAL_BASE_URL', '', 'STRING', false, 'Base URL for support portal links');
    """)


def downgrade():
    # Drop tables in reverse order
    op.drop_index('ix_system_config_config_key', 'system_config')
    op.drop_table('system_config')
    
    op.drop_index('ix_email_delivery_logs_status', 'email_delivery_logs')
    op.drop_index('ix_email_delivery_logs_to_email', 'email_delivery_logs')
    op.drop_index('ix_email_delivery_logs_idempotency_key', 'email_delivery_logs')
    op.drop_index('ix_email_delivery_logs_event_type', 'email_delivery_logs')
    op.drop_table('email_delivery_logs')
    
    op.drop_index('ix_support_tokens_expires_at', 'support_tokens')
    op.drop_index('ix_support_tokens_token_hash', 'support_tokens')
    op.drop_table('support_tokens')
    
    op.drop_index('ix_support_messages_author_user_id', 'support_messages')
    op.drop_index('ix_support_messages_thread_id', 'support_messages')
    op.drop_table('support_messages')
    
    op.drop_index('ix_support_threads_last_message_at', 'support_threads')
    op.drop_index('ix_support_threads_priority', 'support_threads')
    op.drop_index('ix_support_threads_status', 'support_threads')
    op.drop_index('ix_support_threads_created_by_user_id', 'support_threads')
    op.drop_index('ix_support_threads_assignment_id', 'support_threads')
    op.drop_table('support_threads')
    
    # Drop enum types
    op.execute("DROP TYPE IF EXISTS author_type CASCADE;")
    op.execute("DROP TYPE IF EXISTS support_priority CASCADE;")
    op.execute("DROP TYPE IF EXISTS support_thread_status CASCADE;")
