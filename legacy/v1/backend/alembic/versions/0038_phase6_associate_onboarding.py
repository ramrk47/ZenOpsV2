"""Phase 6 associate onboarding hardening + invites.

Revision ID: 0038_phase6_associate_onboarding
Revises: 0037_phase4_policy_driven_land
Create Date: 2026-03-03
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0038_phase6_associate_onboarding"
down_revision: Union[str, None] = "0037_phase4_policy_driven_land"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("partner_account_requests") as batch_op:
        batch_op.add_column(sa.Column("email_verification_token", sa.String(length=128), nullable=True))
        batch_op.add_column(sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("request_ip", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("user_agent", sa.String(length=512), nullable=True))
        batch_op.add_column(sa.Column("rate_limit_bucket", sa.String(length=128), nullable=True))
        batch_op.create_index("ix_partner_account_requests_email_verification_token", ["email_verification_token"], unique=False)
        batch_op.create_index("ix_partner_account_requests_request_ip", ["request_ip"], unique=False)

    op.create_table(
        "partner_request_attempts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("request_ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("rate_limit_bucket", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_partner_request_attempts_email", "partner_request_attempts", ["email"], unique=False)
    op.create_index("ix_partner_request_attempts_request_ip", "partner_request_attempts", ["request_ip"], unique=False)
    op.create_index("ix_partner_request_attempts_created_at", "partner_request_attempts", ["created_at"], unique=False)

    op.create_table(
        "user_invites",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=64), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_invites_email", "user_invites", ["email"], unique=False)
    op.create_index("ix_user_invites_token_hash", "user_invites", ["token_hash"], unique=True)
    op.create_index("ix_user_invites_expires_at", "user_invites", ["expires_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_user_invites_expires_at", table_name="user_invites")
    op.drop_index("ix_user_invites_token_hash", table_name="user_invites")
    op.drop_index("ix_user_invites_email", table_name="user_invites")
    op.drop_table("user_invites")

    op.drop_index("ix_partner_request_attempts_created_at", table_name="partner_request_attempts")
    op.drop_index("ix_partner_request_attempts_request_ip", table_name="partner_request_attempts")
    op.drop_index("ix_partner_request_attempts_email", table_name="partner_request_attempts")
    op.drop_table("partner_request_attempts")

    with op.batch_alter_table("partner_account_requests") as batch_op:
        batch_op.drop_index("ix_partner_account_requests_request_ip")
        batch_op.drop_index("ix_partner_account_requests_email_verification_token")
        batch_op.drop_column("rate_limit_bucket")
        batch_op.drop_column("user_agent")
        batch_op.drop_column("request_ip")
        batch_op.drop_column("email_verified_at")
        batch_op.drop_column("email_verification_token")
