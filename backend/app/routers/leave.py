from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.enums import LeaveStatus, NotificationType, Role
from app.models.leave import LeaveRequest
from app.models.user import User
from app.schemas.leave import LeaveRequestCreate, LeaveRequestRead
from app.services.activity import log_activity
from app.services.leave import approve_leave, reject_leave
from app.services.notifications import notify_roles

router = APIRouter(prefix="/api/leave", tags=["leave"])

APPROVER_ROLES = {Role.ADMIN, Role.HR}


def _require_leave_approver(user: User) -> None:
    if not rbac.user_has_any_role(user, APPROVER_ROLES):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to manage leave")


def _get_leave_or_404(db: Session, leave_id: int) -> LeaveRequest:
    leave = db.get(LeaveRequest, leave_id)
    if not leave:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave request not found")
    return leave


@router.get("", response_model=List[LeaveRequestRead])
def list_leave_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    status_filter: Optional[str] = Query(None, description="Filter by status"),
) -> List[LeaveRequestRead]:
    """List all leave requests (admin/hr sees all, others see own + inbox)."""
    query = db.query(LeaveRequest)
    if current_user.role not in [Role.ADMIN, Role.HR]:
        query = query.filter(
            (LeaveRequest.requester_user_id == current_user.id) |
            (LeaveRequest.approver_user_id == current_user.id)
        )
    if status_filter:
        query = query.filter(LeaveRequest.status == status_filter)
    return query.order_by(LeaveRequest.created_at.desc()).limit(100).all()


@router.post("/request", response_model=LeaveRequestRead, status_code=status.HTTP_201_CREATED)
def request_leave(
    leave_in: LeaveRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> LeaveRequestRead:
    leave = LeaveRequest(
        requester_user_id=current_user.id,
        leave_type=leave_in.leave_type,
        start_date=leave_in.start_date,
        end_date=leave_in.end_date,
        hours=leave_in.hours,
        reason=leave_in.reason,
        status=LeaveStatus.PENDING,
    )
    db.add(leave)
    db.flush()

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="LEAVE_REQUESTED",
        message=f"Leave requested: {leave.leave_type}",
        payload={"leave_request_id": leave.id},
    )

    notify_roles(
        db,
        roles=list(APPROVER_ROLES),
        notif_type=NotificationType.APPROVAL_PENDING,
        message=f"Leave request pending: {current_user.email}",
        payload={"leave_request_id": leave.id},
        exclude_user_ids=[current_user.id],
    )

    db.commit()
    db.refresh(leave)
    return LeaveRequestRead.model_validate(leave)


@router.get("/my", response_model=List[LeaveRequestRead])
def my_leave(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[LeaveRequestRead]:
    leaves = (
        db.query(LeaveRequest)
        .filter(LeaveRequest.requester_user_id == current_user.id)
        .order_by(LeaveRequest.created_at.desc())
        .all()
    )
    return [LeaveRequestRead.model_validate(l) for l in leaves]


@router.get("/inbox", response_model=List[LeaveRequestRead])
def leave_inbox(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[LeaveRequestRead]:
    _require_leave_approver(current_user)
    leaves = (
        db.query(LeaveRequest)
        .filter(LeaveRequest.status == LeaveStatus.PENDING)
        .order_by(LeaveRequest.created_at.asc())
        .all()
    )
    return [LeaveRequestRead.model_validate(l) for l in leaves]


@router.post("/{leave_id}/approve", response_model=LeaveRequestRead)
def approve(
    leave_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> LeaveRequestRead:
    _require_leave_approver(current_user)
    leave = _get_leave_or_404(db, leave_id)
    if leave.status != LeaveStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Leave already decided")

    approve_leave(db, leave=leave, approver_user_id=current_user.id)

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="LEAVE_APPROVED",
        message=f"Leave approved: {leave.id}",
        payload={"leave_request_id": leave.id},
    )

    db.commit()
    db.refresh(leave)
    return LeaveRequestRead.model_validate(leave)


@router.post("/{leave_id}/reject", response_model=LeaveRequestRead)
def reject(
    leave_id: int,
    comment: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> LeaveRequestRead:
    _require_leave_approver(current_user)
    leave = _get_leave_or_404(db, leave_id)
    if leave.status != LeaveStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Leave already decided")

    reject_leave(db, leave=leave, approver_user_id=current_user.id, comment=comment)

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="LEAVE_REJECTED",
        message=f"Leave rejected: {leave.id}",
        payload={"leave_request_id": leave.id, "comment": comment},
    )

    db.commit()
    db.refresh(leave)
    return LeaveRequestRead.model_validate(leave)
