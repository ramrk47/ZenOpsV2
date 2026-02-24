"""
Database configuration and helpers.

This module defines the SQLAlchemy engine, session local class, and the
declarative base used throughout the application.  It reads the
database URL from the environment and sets up lazy session creation for
FastAPI dependencies.
"""

from __future__ import annotations

import os
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase, scoped_session


class Base(DeclarativeBase):
    """Base class for all ORM models."""
    pass


def get_database_url() -> str:
    """Return the database URL from the environment.

    Defaults to a local PostgreSQL instance if not explicitly set.
    """
    return os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/zenops")


engine = create_engine(get_database_url(), echo=False, future=True)

# Use scoped_session to ensure thread safety across async endpoints.  Each
# request will receive its own session via dependency injection.
SessionLocal = scoped_session(sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True))


@contextmanager
def session_scope():
    """Provide a transactional scope around a series of operations.

    This helper is used by the seeding script; FastAPI dependencies
    use the `get_db` generator instead.
    """
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()