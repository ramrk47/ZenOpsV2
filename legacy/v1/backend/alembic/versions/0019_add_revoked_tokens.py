"""Add revoked_tokens table for proper logout support.

Revision ID: 0019_add_revoked_tokens
Revises: 0018_add_totp_mfa
Create Date: 2026-02-07
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0019_add_revoked_tokens"
down_revision = "0018_add_totp_mfa"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "revoked_tokens",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_revoked_tokens_token_hash", "revoked_tokens", ["token_hash"], unique=True)
    op.create_index("ix_revoked_tokens_expires_at", "revoked_tokens", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_revoked_tokens_expires_at", table_name="revoked_tokens")
    op.drop_index("ix_revoked_tokens_token_hash", table_name="revoked_tokens")
    op.drop_table("revoked_tokens")
