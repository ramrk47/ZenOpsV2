"""
Base model to be imported by SQLAlchemy models.

All model classes should inherit from this Base.  It is defined in
``app.db.Base`` and re‑exported here for convenience.
"""

from ..db import Base  # noqa: F401  (re-export Base)