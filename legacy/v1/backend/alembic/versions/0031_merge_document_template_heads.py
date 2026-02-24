"""merge document template heads

Revision ID: 0031_merge_document_template_heads
Revises: 0028_add_document_review_fields, 0030_add_document_templates_bank_scope
Create Date: 2026-02-08 08:51:39.432000

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "0031_merge_document_template_heads"
down_revision = ("0028_add_document_review_fields", "0030_add_document_templates_bank_scope")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
