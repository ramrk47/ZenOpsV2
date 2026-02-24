from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Set

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.enums import LeaveStatus, NotificationType
from app.models.leave import LeaveRequest
from app.services.calendar import upsert_leave_event
from app.services.notifications import create_notification


def _today() -> date:
    return datetime.now(timezone.utc).date()


def users_on_leave(db: Session, on_date: date | None = None) -> Set[int]:
    day = on_date or _today()
    leaves = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.status == LeaveStatus.APPROVED,
            LeaveRequest.start_date <= day,
            or_(LeaveRequest.end_date.is_(None), LeaveRequest.end_date >= day),
        )
        .all()
    )
    return {leave.requester_user_id for leave in leaves}


def current_leave(db: Session, user_id: int, on_date: date | None = None) -> LeaveRequest | None:
    day = on_date or _today()
    return (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.requester_user_id == user_id,
            LeaveRequest.status == LeaveStatus.APPROVED,
            LeaveRequest.start_date <= day,
            or_(LeaveRequest.end_date.is_(None), LeaveRequest.end_date >= day),
        )
        .order_by(LeaveRequest.start_date.desc())
        .first()
    )


def is_user_on_leave(db: Session, user_id: int, on_date: date | None = None) -> bool:
    return user_id in users_on_leave(db, on_date=on_date)


def approve_leave(db: Session, *, leave: LeaveRequest, approver_user_id: int) -> LeaveRequest:
    leave.status = LeaveStatus.APPROVED
    leave.approver_user_id = approver_user_id
    leave.decided_at = datetime.now(timezone.utc)
    db.add(leave)
    db.flush()

    upsert_leave_event(db, leave=leave, actor_user_id=approver_user_id)

    create_notification(
        db,
        user_id=leave.requester_user_id,
        notif_type=NotificationType.LEAVE_APPROVED,
        message="Your leave request was approved",
        payload={"leave_request_id": leave.id},
    )
    return leave


def reject_leave(db: Session, *, leave: LeaveRequest, approver_user_id: int, comment: str | None = None) -> LeaveRequest:
    leave.status = LeaveStatus.REJECTED
    leave.approver_user_id = approver_user_id
    leave.decided_at = datetime.now(timezone.utc)
    db.add(leave)
    db.flush()

    # Clean up any existing calendar event.
    if leave.calendar_event_id:
        from app.models.calendar import CalendarEvent

        event = db.get(CalendarEvent, leave.calendar_event_id)
        if event:
            db.delete(event)
        leave.calendar_event_id = None
        db.add(leave)
        db.flush()

    create_notification(
        db,
        user_id=leave.requester_user_id,
        notif_type=NotificationType.LEAVE_REJECTED,
        message="Your leave request was rejected",
        payload={"leave_request_id": leave.id, "comment": comment},
    )
    return leave
