from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.core import rbac
from app.core.deps import get_current_user
from app.core.step_up import require_step_up
from app.db.session import get_db
from app.models.approval import Approval
from app.models.enums import ApprovalStatus, NotificationType, Role, ApprovalEntityType, ApprovalActionType
from app.models.invoice import Invoice
from app.models.user import User
from app.schemas.approval import ApprovalDecisionPayload, ApprovalRead, ApprovalRequest, ApprovalTemplate
from app.services.approvals import approve as approve_service
from app.services.approvals import reject as reject_service
from app.services.approvals import (
    request_approval,
    required_roles_for_approval,
    is_user_eligible_for_approval,
)
from app.services.activity import log_activity
from app.services.notifications import create_notification, notify_roles
from app.services.studio_billing import emit_invoice_event

router = APIRouter(prefix="/api/approvals", tags=["approvals"])


def _require_approver(user: User) -> None:
    if not rbac.can_approve(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to process approvals")


def _require_not_self_approval(approval: Approval, user: User) -> None:
    if approval.requester_user_id != user.id:
        return
    if rbac.user_has_role(user, Role.ADMIN) and approval.entity_type == ApprovalEntityType.ASSIGNMENT:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Requesters cannot decide their own approvals")


@router.get("", response_model=List[ApprovalRead])
def list_approvals(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    status_filter: Optional[str] = Query(None, description="Filter by status"),
) -> List[ApprovalRead]:
    """List all approvals (admin sees all, others see own + inbox)."""
    query = db.query(Approval)
    if not rbac.user_has_role(current_user, Role.ADMIN):
        query = query.filter(
            (Approval.requester_user_id == current_user.id) |
            (Approval.approver_user_id == current_user.id)
        )
    if status_filter:
        query = query.filter(Approval.status == status_filter)
    return query.order_by(Approval.created_at.desc()).limit(100).all()


@router.post("/request", response_model=ApprovalRead, status_code=status.HTTP_201_CREATED)
def request(
    approval_in: ApprovalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ApprovalRead:
    approval = Approval(
        entity_type=approval_in.entity_type,
        entity_id=approval_in.entity_id,
        action_type=approval_in.action_type,
        requester_user_id=current_user.id,
        approver_user_id=approval_in.approver_user_id,
        status=ApprovalStatus.PENDING,
        reason=approval_in.reason,
        payload_json=approval_in.payload_json,
        assignment_id=approval_in.assignment_id,
    )
    allowed_roles = required_roles_for_approval(approval.entity_type, approval.action_type)
    request_approval(db, approval=approval, allowed_roles=allowed_roles, auto_assign=False)
    db.flush()

    if approval.approver_user_id:
        create_notification(
            db,
            user_id=approval.approver_user_id,
            notif_type=NotificationType.APPROVAL_PENDING,
            message=f"Approval requested: {approval.action_type}",
            payload={"approval_id": approval.id},
        )
    else:
        notify_roles(
            db,
            roles=allowed_roles,
            notif_type=NotificationType.APPROVAL_PENDING,
            message=f"Approval requested: {approval.action_type}",
            payload={"approval_id": approval.id},
            exclude_user_ids=[current_user.id],
        )

    db.commit()
    db.refresh(approval)
    return ApprovalRead.model_validate(approval)


@router.get("/inbox", response_model=List[ApprovalRead])
def inbox(
    include_decided: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[ApprovalRead]:
    _require_approver(current_user)

    query = db.query(Approval)
    if not include_decided:
        query = query.filter(Approval.status == ApprovalStatus.PENDING)

    approvals = (
        query.filter(or_(Approval.approver_user_id == current_user.id, Approval.approver_user_id.is_(None)))
        .order_by(Approval.created_at.desc())
        .all()
    )
    approvals = [a for a in approvals if is_user_eligible_for_approval(a, current_user)]
    return [ApprovalRead.model_validate(a) for a in approvals]


@router.get("/inbox-count", response_model=dict)
def inbox_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _require_approver(current_user)
    approvals = (
        db.query(Approval)
        .filter(Approval.status == ApprovalStatus.PENDING)
        .order_by(Approval.created_at.desc())
        .all()
    )
    eligible = [a for a in approvals if is_user_eligible_for_approval(a, current_user)]
    return {"pending": len(eligible)}


@router.get("/templates", response_model=list[ApprovalTemplate])
def templates(
    _current_user: User = Depends(get_current_user),
) -> list[ApprovalTemplate]:
    return [
        ApprovalTemplate(
            key="review_request",
            label="Review Request",
            description="Lightweight peer review before final submission.",
            entity_type=ApprovalEntityType.ASSIGNMENT,
            action_type=ApprovalActionType.FINAL_REVIEW,
        ),
        ApprovalTemplate(
            key="doc_pickup",
            label="Doc Pickup Permission",
            description="Request permission to pick up documents from branch/client.",
            entity_type=ApprovalEntityType.ASSIGNMENT,
            action_type=ApprovalActionType.DOC_REQUEST,
        ),
        ApprovalTemplate(
            key="final_check",
            label="Final Check Request",
            description="Request final verification before closing the assignment.",
            entity_type=ApprovalEntityType.ASSIGNMENT,
            action_type=ApprovalActionType.FINAL_REVIEW,
        ),
    ]


@router.get("/mine", response_model=List[ApprovalRead])
def mine(
    include_decided: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[ApprovalRead]:
    query = db.query(Approval).filter(Approval.requester_user_id == current_user.id)
    if not include_decided:
        query = query.filter(Approval.status == ApprovalStatus.PENDING)
    approvals = query.order_by(Approval.created_at.desc()).all()
    return [ApprovalRead.model_validate(a) for a in approvals]


# Actions that require step-up re-authentication to approve
_STEP_UP_ACTION_TYPES = {
    ApprovalActionType.FEE_OVERRIDE,
    ApprovalActionType.RESET_MFA,
    ApprovalActionType.CHANGE_ROLE,
    ApprovalActionType.RESET_PASSWORD,
}


@router.post("/{approval_id}/approve", response_model=ApprovalRead)
def approve(
    approval_id: int,
    request: Request,
    payload: ApprovalDecisionPayload | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ApprovalRead:
    _require_approver(current_user)
    approval = db.get(Approval, approval_id)
    if not approval:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approval not found")
    if not is_user_eligible_for_approval(approval, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted to approve this request")
    _require_not_self_approval(approval, current_user)

    # Require step-up for sensitive approval actions
    if approval.action_type in _STEP_UP_ACTION_TYPES:
        require_step_up(request)

    approved = approve_service(db, approval=approval, approver_user_id=current_user.id)
    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="APPROVAL_APPROVED",
        assignment_id=approved.assignment_id,
        message=f"Approval {approved.id} approved",
        payload={"approval_id": approved.id, "action_type": str(approved.action_type)},
    )
    create_notification(
        db,
        user_id=approved.requester_user_id,
        notif_type=NotificationType.APPROVAL_APPROVED,
        message=f"Approval approved: {approved.action_type}",
        payload={"approval_id": approved.id},
    )
    db.commit()
    db.refresh(approved)
    if approved.action_type == ApprovalActionType.MARK_PAID and approved.entity_type == ApprovalEntityType.INVOICE:
        invoice = (
            db.query(Invoice)
            .options(selectinload(Invoice.payments))
            .filter(Invoice.id == approved.entity_id)
            .first()
        )
        if invoice:
            payment = invoice.payments[-1] if invoice.payments else None
            if payment:
                emit_invoice_event("payment_recorded", invoice, payment=payment, extra_payload={"source": "approval"})
            if invoice.is_paid:
                emit_invoice_event("invoice_paid", invoice, payment=payment, extra_payload={"source": "approval"})
    return ApprovalRead.model_validate(approved)


@router.post("/{approval_id}/reject", response_model=ApprovalRead)
def reject(
    approval_id: int,
    payload: ApprovalDecisionPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ApprovalRead:
    _require_approver(current_user)
    approval = db.get(Approval, approval_id)
    if not approval:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approval not found")
    if not is_user_eligible_for_approval(approval, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted to reject this request")
    _require_not_self_approval(approval, current_user)

    rejected = reject_service(db, approval=approval, approver_user_id=current_user.id, comment=payload.comment)
    create_notification(
        db,
        user_id=rejected.requester_user_id,
        notif_type=NotificationType.APPROVAL_REJECTED,
        message=f"Approval rejected: {rejected.action_type}",
        payload={"approval_id": rejected.id, "comment": payload.comment},
    )
    db.commit()
    db.refresh(rejected)
    return ApprovalRead.model_validate(rejected)
