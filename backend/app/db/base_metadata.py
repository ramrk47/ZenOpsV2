"""Alembic target metadata."""

from app.models import Base  # noqa: F401 - ensures all models are imported


target_metadata = Base.metadata
