"""
Leave request routes.

Employees can request leave; HR and Admin users can approve or reject
requests.  Approved leave creates calendar events to reflect staff
absence.
"""

from __future__ import annotations

from datetime import datetime, timedelta, date
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..dependencies import get_db, get_current_active_user
from ..models.leave import LeaveRequest, LeaveStatus, LeaveType
from ..models.calendar import CalendarEvent, EventType
from ..models.user import User
from ..utils import rbac
from ..schemas.leave import LeaveRequestCreate, LeaveRequestRead

router = APIRouter(prefix="/api/leave", tags=["leave"])


@router.post("/request", response_model=LeaveRequestRead, status_code=status.HTTP_201_CREATED)
def request_leave(
    leave_in: LeaveRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Submit a leave request.  The request is initially pending."""
    if leave_in.leave_type == LeaveType.FULL_DAY and not (leave_in.start_date and leave_in.end_date):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start_date and end_date are required for full day leave")
    if leave_in.leave_type == LeaveType.HALF_DAY and not leave_in.start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start_date is required for half day leave")
    if leave_in.leave_type == LeaveType.PERMISSION_HOURS and not (leave_in.start_date and leave_in.hours):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start_date and hours are required for permission hours")
    lr = LeaveRequest(
        requester_user_id=current_user.id,
        leave_type=leave_in.leave_type,
        start_date=leave_in.start_date,
        end_date=leave_in.end_date,
        hours=leave_in.hours,
        reason=leave_in.reason,
    )
    db.add(lr)
    db.commit()
    db.refresh(lr)
    return LeaveRequestRead.from_orm(lr)


@router.get("/my", response_model=list[LeaveRequestRead])
def my_leave_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Return the current user's leave requests."""
    lrs = db.query(LeaveRequest).filter(LeaveRequest.requester_user_id == current_user.id).all()
    return [LeaveRequestRead.from_orm(lr) for lr in lrs]


@router.get("/inbox", response_model=list[LeaveRequestRead])
def leave_inbox(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Return pending leave requests for HR/Admin users."""
    if not rbac.user_has_capability(current_user, "leave.manage"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to view leave inbox")
    requests = db.query(LeaveRequest).filter(LeaveRequest.status == LeaveStatus.PENDING).all()
    return [LeaveRequestRead.from_orm(lr) for lr in requests]


def _get_leave_request(db: Session, leave_id: int) -> LeaveRequest:
    lr = db.get(LeaveRequest, leave_id)
    if not lr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave request not found")
    return lr


@router.post("/{leave_id}/approve", response_model=LeaveRequestRead)
def approve_leave(
    leave_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    lr = _get_leave_request(db, leave_id)
    if lr.status != LeaveStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Leave already processed")
    if not rbac.user_has_capability(current_user, "leave.manage"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to approve leave")
    lr.status = LeaveStatus.APPROVED
    lr.approver_user_id = current_user.id
    lr.decided_at = datetime.utcnow()
    db.commit()
    db.refresh(lr)
    # Create calendar events for approved leave
    def create_event(start: date, end: date):
        ce = CalendarEvent(
            event_type=EventType.LEAVE,
            title=f"Leave: {lr.leave_type}",
            start_at=datetime.combine(start, datetime.min.time()),
            end_at=datetime.combine(end, datetime.max.time()),
            assigned_to_user_id=lr.requester_user_id,
            created_by_user_id=current_user.id,
        )
        db.add(ce)
    if lr.leave_type == LeaveType.FULL_DAY:
        # Create an event spanning start_date to end_date inclusive
        create_event(lr.start_date, lr.end_date or lr.start_date)
    elif lr.leave_type == LeaveType.HALF_DAY:
        create_event(lr.start_date, lr.start_date)
    elif lr.leave_type == LeaveType.PERMISSION_HOURS:
        # Hours event: treat hours as fraction of a day
        start_dt = datetime.combine(lr.start_date, datetime.min.time())
        end_dt = start_dt + timedelta(hours=lr.hours or 0)
        ce = CalendarEvent(
            event_type=EventType.LEAVE,
            title=f"Leave: {lr.leave_type}",
            start_at=start_dt,
            end_at=end_dt,
            assigned_to_user_id=lr.requester_user_id,
            created_by_user_id=current_user.id,
        )
        db.add(ce)
    db.commit()
    return LeaveRequestRead.from_orm(lr)


@router.post("/{leave_id}/reject", response_model=LeaveRequestRead)
def reject_leave(
    leave_id: int,
    reason: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    lr = _get_leave_request(db, leave_id)
    if lr.status != LeaveStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Leave already processed")
    if not rbac.user_has_capability(current_user, "leave.manage"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to reject leave")
    lr.status = LeaveStatus.REJECTED
    lr.approver_user_id = current_user.id
    lr.decided_at = datetime.utcnow()
    db.commit()
    db.refresh(lr)
    return LeaveRequestRead.from_orm(lr)