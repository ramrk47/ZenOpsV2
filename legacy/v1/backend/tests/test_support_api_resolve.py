from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models.enums import AuthorType, Role, SupportPriority, SupportThreadStatus
from app.models.support import SupportMessage, SupportThread
from app.models.user import User
from app.routers.support import get_support_thread, resolve_support_thread


def test_resolve_support_thread_sets_closed_at_and_persists():
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(
        bind=engine,
        tables=[User.__table__, SupportThread.__table__, SupportMessage.__table__],
    )
    db = TestingSessionLocal()

    try:
        admin = User(
            email="support-admin@example.com",
            hashed_password="not-used",
            role=Role.ADMIN,
            full_name="Support Admin",
            is_active=True,
        )
        db.add(admin)
        db.flush()

        thread = SupportThread(
            subject="Resolve timestamp smoke",
            created_by_user_id=admin.id,
            created_via=AuthorType.INTERNAL,
            status=SupportThreadStatus.OPEN,
            priority=SupportPriority.MEDIUM,
        )
        db.add(thread)
        db.commit()
        db.refresh(thread)

        resolved = resolve_support_thread(thread.id, db=db, current_user=admin)
        assert resolved.status == SupportThreadStatus.RESOLVED
        assert resolved.closed_at is not None

        db.expire_all()
        detail = get_support_thread(thread.id, db=db, current_user=admin)
        assert detail.status == SupportThreadStatus.RESOLVED
        assert detail.closed_at == resolved.closed_at
    finally:
        db.close()
