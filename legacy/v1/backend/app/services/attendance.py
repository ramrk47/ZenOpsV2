"""Attendance / work session service layer."""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.work_session import WorkSession

# A session that hasn't received a heartbeat in this many minutes is
# considered stale and will be auto-closed.
STALE_SESSION_MINUTES = 30


def record_heartbeat(
    db: Session,
    *,
    user_id: int,
    session_type: str = "AUTO",
) -> WorkSession:
    """Create or update today's work session for *user_id*.

    If a session exists for the same calendar day that hasn't been closed,
    we bump ``last_seen_at``.  Otherwise we create a new one.
    """
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    session = (
        db.query(WorkSession)
        .filter(
            WorkSession.user_id == user_id,
            WorkSession.login_at >= today_start,
            WorkSession.logout_at.is_(None),
        )
        .order_by(WorkSession.login_at.desc())
        .first()
    )

    if session:
        session.last_seen_at = now
        session.updated_at = now
    else:
        session = WorkSession(
            user_id=user_id,
            login_at=now,
            last_seen_at=now,
            session_type=session_type,
        )
        db.add(session)

    db.flush()
    return session


def close_session(db: Session, *, user_id: int) -> Optional[WorkSession]:
    """Close the active session for *user_id* (e.g. on logout)."""
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    session = (
        db.query(WorkSession)
        .filter(
            WorkSession.user_id == user_id,
            WorkSession.login_at >= today_start,
            WorkSession.logout_at.is_(None),
        )
        .order_by(WorkSession.login_at.desc())
        .first()
    )

    if session:
        session.logout_at = now
        session.last_seen_at = now
        elapsed = (now - session.login_at).total_seconds()
        session.duration_minutes = max(int(elapsed / 60), 1)
        session.updated_at = now
        db.flush()

    return session


def close_stale_sessions(db: Session) -> int:
    """Close work sessions that haven't received a heartbeat recently."""
    threshold = datetime.now(timezone.utc) - timedelta(minutes=STALE_SESSION_MINUTES)
    stale = (
        db.query(WorkSession)
        .filter(
            WorkSession.logout_at.is_(None),
            WorkSession.last_seen_at < threshold,
        )
        .all()
    )
    now = datetime.now(timezone.utc)
    for session in stale:
        session.logout_at = session.last_seen_at
        elapsed = (session.last_seen_at - session.login_at).total_seconds()
        session.duration_minutes = max(int(elapsed / 60), 1)
        session.updated_at = now
    db.flush()
    return len(stale)


def export_csv(
    db: Session,
    *,
    user_id: Optional[int] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
) -> str:
    """Generate a CSV string of work sessions."""
    query = db.query(WorkSession).join(User, WorkSession.user_id == User.id)

    if user_id:
        query = query.filter(WorkSession.user_id == user_id)
    if from_date:
        query = query.filter(WorkSession.login_at >= datetime.combine(from_date, datetime.min.time(), tzinfo=timezone.utc))
    if to_date:
        query = query.filter(WorkSession.login_at <= datetime.combine(to_date, datetime.max.time(), tzinfo=timezone.utc))

    sessions = query.order_by(WorkSession.login_at.desc()).all()

    # Build user lookup for names
    user_ids = {s.user_id for s in sessions}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["User ID", "Name", "Email", "Login At", "Last Seen At", "Logout At", "Duration (min)", "Type"])
    for s in sessions:
        u = users.get(s.user_id)
        writer.writerow([
            s.user_id,
            u.full_name if u else "",
            u.email if u else "",
            s.login_at.isoformat() if s.login_at else "",
            s.last_seen_at.isoformat() if s.last_seen_at else "",
            s.logout_at.isoformat() if s.logout_at else "",
            s.duration_minutes or "",
            s.session_type,
        ])
    return output.getvalue()
