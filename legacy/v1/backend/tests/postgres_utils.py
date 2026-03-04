from __future__ import annotations

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.settings import settings
from app.db.base import Base


def create_postgres_test_session():
    database_url = settings.database_url
    if not database_url.startswith("postgresql"):
        raise RuntimeError(
            "Phase RC tests require PostgreSQL. "
            f"Current DATABASE_URL={database_url!r}"
        )

    engine = create_engine(database_url)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    Base.metadata.create_all(bind=engine)
    return engine, sessionmaker(bind=engine, autoflush=False, autocommit=False)
