from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.security import get_password_hash
from app.models.approval import Approval
from app.models.assignment import Assignment
from app.models.document import AssignmentDocument
from app.models.enums import (
    ApprovalActionType,
    ApprovalEntityType,
    ApprovalStatus,
    ApprovalType,
    AssignmentStatus,
    DocumentReviewStatus,
    Role,
)
from app.models.invoice import Invoice, InvoicePayment
from app.models.user import User
from app.services.activity import log_activity
from app.services.assignments import generate_assignment_code
from app.services.invoices import mark_invoice_paid, recompute_invoice_balance


APPROVAL_ROUTING: dict[ApprovalEntityType, list[Role]] = {
    ApprovalEntityType.ASSIGNMENT: [Role.OPS_MANAGER, Role.ADMIN],
    ApprovalEntityType.DOCUMENT: [Role.OPS_MANAGER, Role.ADMIN],
    ApprovalEntityType.PAYMENT: [Role.FINANCE, Role.ADMIN],
    ApprovalEntityType.LEAVE: [Role.HR, Role.ADMIN],
    ApprovalEntityType.INVOICE: [Role.FINANCE, Role.ADMIN],
    ApprovalEntityType.USER: [Role.ADMIN],
}

APPROVAL_TYPE_ROUTING: dict[ApprovalType, list[Role]] = {
    ApprovalType.DRAFT_ASSIGNMENT: [Role.OPS_MANAGER, Role.ADMIN],
    ApprovalType.FINAL_DOC_REVIEW: [Role.OPS_MANAGER, Role.ADMIN],
    ApprovalType.PAYMENT_CONFIRMATION: [Role.FINANCE, Role.ADMIN],
}


def required_roles_for_approval(
    entity_type: ApprovalEntityType,
    action_type: ApprovalActionType | None = None,
    approval_type: ApprovalType | None = None,
) -> list[Role]:
    if approval_type and approval_type in APPROVAL_TYPE_ROUTING:
        return APPROVAL_TYPE_ROUTING[approval_type]
    # Default to entity routing when available; fall back to admin.
    return APPROVAL_ROUTING.get(entity_type, [Role.ADMIN])


def _pick_default_approver(db: Session, roles: Optional[list[Role]] = None) -> Optional[int]:
    preferred_roles = roles or [Role.OPS_MANAGER, Role.ADMIN, Role.HR, Role.FINANCE]
    for role in preferred_roles:
        user = (
            db.query(User)
            .filter(User.has_role(role), User.is_active.is_(True))
            .order_by(User.id.asc())
            .first()
        )
        if user:
            return user.id
    return None


def request_approval(
    db: Session,
    *,
    approval: Approval,
    allowed_roles: Optional[list[Role]] = None,
    auto_assign: bool = False,
) -> Approval:
    if not approval.requested_at:
        approval.requested_at = datetime.now(timezone.utc)

    roles = allowed_roles or required_roles_for_approval(
        approval.entity_type,
        approval.action_type,
        approval.approval_type,
    )
    if approval.approver_user_id:
        approver = db.get(User, approval.approver_user_id)
        if not approver or not approver.is_active or not rbac.user_has_any_role(approver, roles):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid approver for this request")
    elif auto_assign:
        approval.approver_user_id = _pick_default_approver(db, roles)

    # Ensure at least one eligible approver exists to avoid deadlocks.
    eligible_exists = db.query(User).filter(User.has_any_role(roles), User.is_active.is_(True)).first()
    if not eligible_exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No eligible approver available")

    db.add(approval)
    db.flush()
    return approval


def _require_pending(approval: Approval) -> None:
    if approval.status != ApprovalStatus.PENDING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Approval already decided")


def _apply_assignment_delete(db: Session, approval: Approval, actor_user_id: int) -> None:
    assignment = db.get(Assignment, approval.entity_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    assignment.is_deleted = True
    assignment.deleted_at = datetime.now(timezone.utc)
    assignment.deleted_by_user_id = actor_user_id
    db.add(assignment)
    log_activity(
        db,
        actor_user_id=actor_user_id,
        activity_type="ASSIGNMENT_DELETED",
        assignment_id=assignment.id,
        message="Assignment deleted via approval",
        payload={"approval_id": approval.id},
    )


def _apply_assignment_reassign(db: Session, approval: Approval, actor_user_id: int) -> None:
    assignment = db.get(Assignment, approval.entity_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    payload = approval.payload_json or {}
    new_assignee = payload.get("assigned_to_user_id")
    if not new_assignee:
        raise HTTPException(status_code=400, detail="assigned_to_user_id missing in payload")
    assignment.assigned_to_user_id = int(new_assignee)
    assignment.assigned_at = datetime.now(timezone.utc)
    db.add(assignment)
    log_activity(
        db,
        actor_user_id=actor_user_id,
        activity_type="ASSIGNMENT_REASSIGNED",
        assignment_id=assignment.id,
        message="Assignment reassigned via approval",
        payload={"approval_id": approval.id, "assigned_to_user_id": assignment.assigned_to_user_id},
    )


def _apply_fee_override(db: Session, approval: Approval, actor_user_id: int) -> None:
    assignment = db.get(Assignment, approval.entity_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    payload = approval.payload_json or {}
    fees = payload.get("fees")
    if fees is None:
        raise HTTPException(status_code=400, detail="fees missing in payload")
    assignment.fees = fees
    db.add(assignment)
    log_activity(
        db,
        actor_user_id=actor_user_id,
        activity_type="ASSIGNMENT_FEE_OVERRIDE",
        assignment_id=assignment.id,
        message="Fees overridden via approval",
        payload={"approval_id": approval.id, "fees": fees},
    )


def _apply_close_assignment(db: Session, approval: Approval, actor_user_id: int) -> None:
    assignment = db.get(Assignment, approval.entity_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    assignment.status = AssignmentStatus.COMPLETED
    assignment.completed_at = datetime.now(timezone.utc)
    db.add(assignment)
    log_activity(
        db,
        actor_user_id=actor_user_id,
        activity_type="ASSIGNMENT_CLOSED",
        assignment_id=assignment.id,
        message="Assignment closed via approval",
        payload={"approval_id": approval.id},
    )


def _apply_reset_password(db: Session, approval: Approval, actor_user_id: int) -> None:
    user = db.get(User, approval.entity_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    payload = approval.payload_json or {}
    new_password = payload.get("password")
    if not new_password:
        raise HTTPException(status_code=400, detail="password missing in payload")
    user.hashed_password = get_password_hash(str(new_password))
    db.add(user)
    log_activity(
        db,
        actor_user_id=actor_user_id,
        activity_type="USER_PASSWORD_RESET",
        message="Password reset via approval",
        payload={"approval_id": approval.id, "user_id": user.id},
    )


def _apply_change_role(db: Session, approval: Approval, actor_user_id: int) -> None:
    user = db.get(User, approval.entity_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    payload = approval.payload_json or {}
    role_value = payload.get("role")
    if not role_value:
        raise HTTPException(status_code=400, detail="role missing in payload")
    user.role = Role(role_value)
    user.roles = [user.role.value]
    db.add(user)
    log_activity(
        db,
        actor_user_id=actor_user_id,
        activity_type="USER_ROLE_CHANGED",
        message="Role changed via approval",
        payload={"approval_id": approval.id, "user_id": user.id, "role": str(user.role)},
    )


def _apply_mark_paid(db: Session, approval: Approval, actor_user_id: int) -> None:
    if approval.entity_type == ApprovalEntityType.INVOICE:
        invoice = db.get(Invoice, approval.entity_id)
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")
        mark_invoice_paid(db, invoice=invoice, actor_user_id=actor_user_id)
        return
    assignment = db.get(Assignment, approval.entity_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    assignment.is_paid = True
    db.add(assignment)
    log_activity(
        db,
        actor_user_id=actor_user_id,
        activity_type="ASSIGNMENT_MARKED_PAID",
        assignment_id=assignment.id,
        message="Assignment marked as paid via approval",
        payload={"approval_id": approval.id},
    )


def _apply_reset_mfa(db: Session, approval: Approval, actor_user_id: int) -> None:
    user = db.get(User, approval.entity_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.totp_secret = None
    user.totp_enabled = False
    user.backup_codes_hash = None
    db.add(user)
    log_activity(
        db,
        actor_user_id=actor_user_id,
        activity_type="USER_MFA_RESET",
        message="MFA reset via admin approval",
        payload={"approval_id": approval.id, "user_id": user.id},
    )


def _apply_draft_assignment_approval(db: Session, approval: Approval, actor_user_id: int) -> None:
    assignment = db.get(Assignment, approval.entity_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    previous_code = assignment.assignment_code
    assignment.assignment_code = generate_assignment_code(db)
    assignment.status = AssignmentStatus.PENDING
    db.add(assignment)

    meta = dict(approval.metadata_json or {})
    meta["temporary_code"] = previous_code
    meta["permanent_code"] = assignment.assignment_code
    approval.metadata_json = meta
    db.add(approval)

    log_activity(
        db,
        actor_user_id=actor_user_id,
        activity_type="ASSIGNMENT_DRAFT_APPROVED",
        assignment_id=assignment.id,
        message=f"Draft approved: {previous_code} -> {assignment.assignment_code}",
        payload={"approval_id": approval.id},
    )


def _apply_draft_assignment_rejection(db: Session, approval: Approval, actor_user_id: int) -> None:
    assignment = db.get(Assignment, approval.entity_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    assignment.status = AssignmentStatus.DRAFT_REJECTED
    db.add(assignment)
    log_activity(
        db,
        actor_user_id=actor_user_id,
        activity_type="ASSIGNMENT_DRAFT_REJECTED",
        assignment_id=assignment.id,
        message="Draft assignment rejected",
        payload={"approval_id": approval.id, "reason": approval.decision_reason},
    )


def _apply_final_doc_review_approval(db: Session, approval: Approval, actor_user_id: int) -> None:
    document = db.get(AssignmentDocument, approval.entity_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    if document.category:
        existing_finals = (
            db.query(AssignmentDocument)
            .filter(
                AssignmentDocument.assignment_id == document.assignment_id,
                AssignmentDocument.category == document.category,
                AssignmentDocument.is_final.is_(True),
                AssignmentDocument.id != document.id,
            )
            .all()
        )
        for row in existing_finals:
            row.is_final = False
            db.add(row)

    document.is_final = True
    document.review_status = DocumentReviewStatus.FINAL
    document.reviewed_by_user_id = actor_user_id
    document.reviewed_at = datetime.now(timezone.utc)
    db.add(document)

    log_activity(
        db,
        actor_user_id=actor_user_id,
        activity_type="DOCUMENT_FINAL_APPROVED",
        assignment_id=document.assignment_id,
        payload={"approval_id": approval.id, "document_id": document.id},
    )


def _apply_final_doc_review_rejection(db: Session, approval: Approval, actor_user_id: int) -> None:
    document = db.get(AssignmentDocument, approval.entity_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    document.is_final = False
    if document.review_status == DocumentReviewStatus.FINAL_PENDING_APPROVAL:
        document.review_status = DocumentReviewStatus.REVIEWED
    document.reviewed_by_user_id = actor_user_id
    document.reviewed_at = datetime.now(timezone.utc)
    db.add(document)

    log_activity(
        db,
        actor_user_id=actor_user_id,
        activity_type="DOCUMENT_FINAL_REJECTED",
        assignment_id=document.assignment_id,
        payload={"approval_id": approval.id, "document_id": document.id, "reason": approval.decision_reason},
    )


def _apply_payment_confirmation_approval(db: Session, approval: Approval, actor_user_id: int) -> None:
    payment = db.get(InvoicePayment, approval.entity_id)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    payment.confirmation_status = "CONFIRMED"
    payment.confirmed_by_user_id = actor_user_id
    payment.confirmed_at = datetime.now(timezone.utc)
    payment.confirmation_reason = approval.decision_reason
    payment.approval_id = approval.id
    db.add(payment)

    invoice = db.get(Invoice, payment.invoice_id)
    if invoice:
        recompute_invoice_balance(invoice)
        db.add(invoice)
        if invoice.assignment:
            invoice.assignment.is_paid = invoice.is_paid
            db.add(invoice.assignment)
        log_activity(
            db,
            actor_user_id=actor_user_id,
            activity_type="PAYMENT_CONFIRMATION_APPROVED",
            assignment_id=invoice.assignment_id,
            payload={"approval_id": approval.id, "invoice_id": invoice.id, "payment_id": payment.id},
        )


def _apply_payment_confirmation_rejection(db: Session, approval: Approval, actor_user_id: int) -> None:
    payment = db.get(InvoicePayment, approval.entity_id)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    payment.confirmation_status = "REJECTED"
    payment.confirmed_by_user_id = actor_user_id
    payment.confirmed_at = datetime.now(timezone.utc)
    payment.confirmation_reason = approval.decision_reason
    payment.approval_id = approval.id
    db.add(payment)

    invoice = db.get(Invoice, payment.invoice_id)
    if invoice:
        recompute_invoice_balance(invoice)
        db.add(invoice)
        if invoice.assignment:
            invoice.assignment.is_paid = invoice.is_paid
            db.add(invoice.assignment)
        log_activity(
            db,
            actor_user_id=actor_user_id,
            activity_type="PAYMENT_CONFIRMATION_REJECTED",
            assignment_id=invoice.assignment_id,
            payload={"approval_id": approval.id, "invoice_id": invoice.id, "payment_id": payment.id},
        )


def apply_approval_action(db: Session, approval: Approval, actor_user_id: int) -> None:
    if approval.approval_type == ApprovalType.DRAFT_ASSIGNMENT:
        _apply_draft_assignment_approval(db, approval, actor_user_id)
        return
    if approval.approval_type == ApprovalType.FINAL_DOC_REVIEW:
        _apply_final_doc_review_approval(db, approval, actor_user_id)
        return
    if approval.approval_type == ApprovalType.PAYMENT_CONFIRMATION:
        _apply_payment_confirmation_approval(db, approval, actor_user_id)
        return

    action = approval.action_type
    if action == ApprovalActionType.DELETE_ASSIGNMENT:
        _apply_assignment_delete(db, approval, actor_user_id)
    elif action == ApprovalActionType.REASSIGN:
        _apply_assignment_reassign(db, approval, actor_user_id)
    elif action == ApprovalActionType.FEE_OVERRIDE:
        _apply_fee_override(db, approval, actor_user_id)
    elif action == ApprovalActionType.CLOSE_ASSIGNMENT:
        _apply_close_assignment(db, approval, actor_user_id)
    elif action == ApprovalActionType.RESET_PASSWORD:
        _apply_reset_password(db, approval, actor_user_id)
    elif action == ApprovalActionType.CHANGE_ROLE:
        _apply_change_role(db, approval, actor_user_id)
    elif action == ApprovalActionType.MARK_PAID:
        _apply_mark_paid(db, approval, actor_user_id)
    elif action == ApprovalActionType.RESET_MFA:
        _apply_reset_mfa(db, approval, actor_user_id)
    else:
        # Action acknowledged but does not trigger additional mutation.
        log_activity(
            db,
            actor_user_id=actor_user_id,
            activity_type="APPROVAL_APPROVED_NOOP",
            message=f"Approval {approval.id} approved with no direct action",
            payload={"action_type": str(action)},
        )


def approve(
    db: Session,
    *,
    approval: Approval,
    approver_user_id: int,
    comment: str | None = None,
) -> Approval:
    _require_pending(approval)
    approval.status = ApprovalStatus.APPROVED
    approval.approver_user_id = approver_user_id
    approval.decided_at = datetime.now(timezone.utc)
    if comment:
        approval.decision_reason = comment
    db.add(approval)
    db.flush()

    apply_approval_action(db, approval, approver_user_id)
    db.flush()
    return approval


def reject(db: Session, *, approval: Approval, approver_user_id: int, comment: str | None = None) -> Approval:
    _require_pending(approval)
    approval.status = ApprovalStatus.REJECTED
    approval.approver_user_id = approver_user_id
    approval.decided_at = datetime.now(timezone.utc)
    approval.decision_reason = comment
    payload = approval.payload_json or {}
    if comment:
        payload["rejection_comment"] = comment
        approval.payload_json = payload
    db.add(approval)
    db.flush()

    if approval.approval_type == ApprovalType.DRAFT_ASSIGNMENT:
        _apply_draft_assignment_rejection(db, approval, approver_user_id)
    elif approval.approval_type == ApprovalType.FINAL_DOC_REVIEW:
        _apply_final_doc_review_rejection(db, approval, approver_user_id)
    elif approval.approval_type == ApprovalType.PAYMENT_CONFIRMATION:
        _apply_payment_confirmation_rejection(db, approval, approver_user_id)
    else:
        log_activity(
            db,
            actor_user_id=approver_user_id,
            activity_type="APPROVAL_REJECTED",
            assignment_id=approval.assignment_id,
            message=f"Approval {approval.id} rejected",
            payload={"comment": comment, "action_type": str(approval.action_type)},
        )
    return approval


def is_user_eligible_for_approval(approval: Approval, user: User) -> bool:
    if approval.approver_user_id and approval.approver_user_id != user.id:
        return False
    if approval.approver_user_id:
        return True
    allowed_roles = required_roles_for_approval(approval.entity_type, approval.action_type, approval.approval_type)
    return rbac.user_has_any_role(user, allowed_roles)
