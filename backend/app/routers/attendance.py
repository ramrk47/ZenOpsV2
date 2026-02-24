"""Attendance / work session router — HR & Admin attendance tracking."""

from __future__ import annotations

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.enums import Role
from app.models.user import User
from app.models.work_session import WorkSession
from app.schemas.attendance import WorkSessionRead
from app.services.attendance import close_stale_sessions, export_csv, record_heartbeat

router = APIRouter(prefix="/api/attendance", tags=["attendance"])


def _require_hr_or_admin(user: User) -> None:
    if not rbac.user_has_any_role(user, {Role.ADMIN, Role.HR, Role.OPS_MANAGER}):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised")


@router.post("/heartbeat", response_model=WorkSessionRead)
def attendance_heartbeat(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkSessionRead:
    """Record or update the current user's work session.

    Called by the frontend heartbeat interval alongside the auth heartbeat.
    """
    session = record_heartbeat(db, user_id=current_user.id)
    db.commit()
    db.refresh(session)
    return WorkSessionRead.model_validate(session)


@router.get("", response_model=List[WorkSessionRead])
def list_sessions(
    user_id: Optional[int] = Query(None),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[WorkSessionRead]:
    """List work sessions.  HR / Admin only (or own sessions)."""
    is_admin = rbac.user_has_any_role(current_user, {Role.ADMIN, Role.HR, Role.OPS_MANAGER})

    query = db.query(WorkSession)

    if user_id:
        if user_id != current_user.id and not is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised")
        query = query.filter(WorkSession.user_id == user_id)
    elif not is_admin:
        # Non-admin users can only see their own sessions
        query = query.filter(WorkSession.user_id == current_user.id)

    if from_date:
        from datetime import datetime, timezone
        query = query.filter(WorkSession.login_at >= datetime.combine(from_date, datetime.min.time(), tzinfo=timezone.utc))
    if to_date:
        from datetime import datetime, timezone
        query = query.filter(WorkSession.login_at <= datetime.combine(to_date, datetime.max.time(), tzinfo=timezone.utc))

    sessions = query.order_by(WorkSession.login_at.desc()).limit(500).all()
    return [WorkSessionRead.model_validate(s) for s in sessions]


@router.get("/export")
def export_attendance(
    user_id: Optional[int] = Query(None),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export attendance data as CSV.  HR / Admin only."""
    _require_hr_or_admin(current_user)

    # Close stale sessions first so the export is up to date
    close_stale_sessions(db)
    db.commit()

    csv_content = export_csv(db, user_id=user_id, from_date=from_date, to_date=to_date)
    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=attendance.csv"},
    )
