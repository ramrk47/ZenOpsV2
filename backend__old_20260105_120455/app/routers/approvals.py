"""
Approval routes.

Used to request, view, approve or reject approval requests for
sensitive actions such as deleting assignments or marking invoices as
paid.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..dependencies import get_db, get_current_active_user, require_capability
from ..models.approval import Approval, ApprovalStatus
from datetime import datetime
from ..models.user import User
from ..schemas.approval import ApprovalCreate, ApprovalRead

router = APIRouter(prefix="/api/approvals", tags=["approvals"])


@router.post("/request", response_model=ApprovalRead, status_code=status.HTTP_201_CREATED)
def request_approval(
    approval_in: ApprovalCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Create a new approval request for a sensitive action."""
    approval = Approval(
        entity_type=approval_in.entity_type,
        entity_id=approval_in.entity_id,
        action_type=approval_in.action_type,
        requester_user_id=current_user.id,
        reason=approval_in.reason,
        payload_json=approval_in.payload_json,
    )
    db.add(approval)
    db.commit()
    db.refresh(approval)
    return ApprovalRead.from_orm(approval)


@router.get("/inbox", response_model=list[ApprovalRead])
def approvals_inbox(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_capability("approvals.manage")),
):
    """Return all pending approval requests.  Admin/ops/hr roles only."""
    approvals = db.query(Approval).filter(Approval.status == ApprovalStatus.PENDING).all()
    return [ApprovalRead.from_orm(a) for a in approvals]


def _get_approval(db: Session, approval_id: int) -> Approval:
    approval = db.get(Approval, approval_id)
    if not approval:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approval not found")
    return approval


@router.post("/{approval_id}/approve", response_model=ApprovalRead)
def approve_request(
    approval_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_capability("approvals.manage")),
):
    approval = _get_approval(db, approval_id)
    if approval.status != ApprovalStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Approval already processed")
    approval.status = ApprovalStatus.APPROVED
    approval.approver_user_id = current_user.id
    approval.decided_at = datetime.utcnow()
    db.commit()
    db.refresh(approval)
    # TODO: perform the action after approval (e.g. mark invoice paid)
    return ApprovalRead.from_orm(approval)


@router.post("/{approval_id}/reject", response_model=ApprovalRead)
def reject_request(
    approval_id: int,
    reason: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_capability("approvals.manage")),
):
    approval = _get_approval(db, approval_id)
    if approval.status != ApprovalStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Approval already processed")
    approval.status = ApprovalStatus.REJECTED
    approval.reason = reason
    approval.approver_user_id = current_user.id
    approval.decided_at = datetime.utcnow()
    db.commit()
    db.refresh(approval)
    return ApprovalRead.from_orm(approval)