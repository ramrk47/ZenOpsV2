"""add bank scoped fields to document templates

Revision ID: 0030_add_document_templates_bank_scope
Revises: 0029_add_document_templates
Create Date: 2026-02-08 08:51:39.432000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0030_add_document_templates_bank_scope"
down_revision = "0029_add_document_templates"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("document_templates") as batch_op:
        batch_op.add_column(sa.Column("bank_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("branch_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("scope_type", sa.String(length=50), nullable=True))
        batch_op.create_index("ix_document_templates_bank_id", ["bank_id"])
        batch_op.create_index("ix_document_templates_branch_id", ["branch_id"])
        batch_op.create_foreign_key(
            "fk_document_templates_bank_id",
            "banks",
            ["bank_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_foreign_key(
            "fk_document_templates_branch_id",
            "branches",
            ["branch_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade():
    with op.batch_alter_table("document_templates") as batch_op:
        batch_op.drop_constraint("fk_document_templates_branch_id", type_="foreignkey")
        batch_op.drop_constraint("fk_document_templates_bank_id", type_="foreignkey")
        batch_op.drop_index("ix_document_templates_branch_id")
        batch_op.drop_index("ix_document_templates_bank_id")
        batch_op.drop_column("scope_type")
        batch_op.drop_column("branch_id")
        batch_op.drop_column("bank_id")
