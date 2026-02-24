from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from uuid import uuid4
import shutil

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.deps import get_current_user
from app.core.settings import settings
from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.document import AssignmentDocument
from app.models.enums import (
    AssignmentStatus,
    CaseType,
    CommissionRequestStatus,
    NotificationType,
    PartnerRequestDirection,
    PartnerRequestEntityType,
    PartnerRequestStatus,
    PartnerRequestType,
    Role,
    ServiceLine,
)
from app.models.invoice import Invoice
from app.models.partner import (
    CommissionRequest,
    CommissionRequestDocument,
    ExternalPartner,
    PartnerDeliverable,
    PartnerRequest,
    PartnerRequestAttachment,
)
from app.models.user import User
from app.schemas.partner import (
    CommissionApprovePayload,
    CommissionNeedsInfoPayload,
    CommissionRejectPayload,
    CommissionRequestAdminRead,
    CommissionRequestSummary,
    PartnerDeliverableRead,
    PartnerDeliverableReleasePayload,
    PartnerRequestAdminCreate,
    PartnerRequestAttachmentRead,
    PartnerRequestRead,
    PartnerSummaryRead,
)
from app.services.assignments import generate_assignment_code, sync_assignment_floors
from app.services.partners import notify_partner_users
from app.services.studio_billing import resolve_assignment_account_key, studio_billing_adapter

router = APIRouter(prefix="/api/admin", tags=["partner-admin"])


def _require_admin_ops(user: User) -> None:
    if not rbac.user_has_any_role(user, {Role.ADMIN, Role.OPS_MANAGER}):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised")


def _require_finance_or_admin(user: User) -> None:
    if not rbac.user_has_any_role(user, {Role.ADMIN, Role.FINANCE, Role.OPS_MANAGER}):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised")


def _get_commission_or_404(db: Session, commission_id: int) -> CommissionRequest:
    commission = db.get(CommissionRequest, commission_id)
    if not commission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Commission request not found")
    return commission


def _assignment_upload_dir(assignment: Assignment) -> Path:
    base = settings.ensure_uploads_dir()
    path = base / assignment.assignment_code
    path.mkdir(parents=True, exist_ok=True)
    return path


def _copy_commission_docs(db: Session, commission: CommissionRequest, assignment: Assignment) -> None:
    documents = (
        db.query(CommissionRequestDocument)
        .filter(CommissionRequestDocument.commission_request_id == commission.id)
        .all()
    )
    if not documents:
        return
    upload_dir = _assignment_upload_dir(assignment)
    for doc in documents:
        src = Path(doc.storage_path)
        if not src.exists():
            continue
        suffix = src.suffix
        filename = f"{uuid4().hex}{suffix}"
        dest = upload_dir / filename
        shutil.copy2(src, dest)
        assignment_doc = AssignmentDocument(
            assignment_id=assignment.id,
            uploaded_by_user_id=doc.uploaded_by_user_id,
            original_name=doc.original_name,
            storage_path=str(dest),
            mime_type=doc.mime_type,
            size=doc.size,
            category=doc.category,
            version_number=1,
            is_final=False,
        )
        db.add(assignment_doc)


def _ensure_partner_exists(db: Session, partner_id: int) -> ExternalPartner:
    partner = db.get(ExternalPartner, partner_id)
    if not partner:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Partner not found")
    return partner


def _ensure_invoice_paid(db: Session, assignment_id: int) -> bool:
    invoices = db.query(Invoice).filter(Invoice.assignment_id == assignment_id).all()
    return any(inv.is_paid for inv in invoices)


@router.get("/commissions", response_model=list[CommissionRequestSummary])
def list_commissions(
    status_filter: CommissionRequestStatus | None = Query(None, alias="status"),
    partner_id: int | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[CommissionRequestSummary]:
    _require_admin_ops(current_user)
    query = db.query(CommissionRequest)
    if status_filter:
        query = query.filter(CommissionRequest.status == status_filter)
    if partner_id:
        query = query.filter(CommissionRequest.partner_id == partner_id)
    rows = query.order_by(CommissionRequest.updated_at.desc()).all()
    return [CommissionRequestSummary.model_validate(row) for row in rows]


@router.get("/commissions/{commission_id}", response_model=CommissionRequestAdminRead)
def get_commission(
    commission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommissionRequestAdminRead:
    _require_admin_ops(current_user)
    commission = _get_commission_or_404(db, commission_id)
    return CommissionRequestAdminRead.model_validate(commission)


@router.get("/commissions/{commission_id}/billing-status", response_model=dict)
def get_commission_billing_status(
    commission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _require_admin_ops(current_user)
    commission = _get_commission_or_404(db, commission_id)
    account_key = resolve_assignment_account_key(
        assignment_id=commission.converted_assignment_id or commission.id,
        partner_id=commission.partner_id,
    )
    status = studio_billing_adapter.get_billing_status(account_key)
    billing_mode = str(status.get("billing_mode") or settings.default_billing_mode).upper()
    account_status = str(status.get("account_status") or "ACTIVE").upper()
    credit = status.get("credit") if isinstance(status.get("credit"), dict) else {}
    available = int(credit.get("available") or 0)
    reserved = int(credit.get("reserved") or 0)
    total = int(credit.get("wallet") or credit.get("total") or 0)
    return {
        "commission_id": commission.id,
        "partner_id": commission.partner_id,
        "account_key": account_key,
        "billing_mode": billing_mode,
        "account_status": account_status,
        "credit": {
            "total": total,
            "reserved": reserved,
            "available": available,
        },
        "can_use_credits": billing_mode == "CREDIT" and available > 0,
        "insufficient_credits": billing_mode == "CREDIT" and available <= 0,
    }


@router.post("/commissions/{commission_id}/needs-info", response_model=CommissionRequestAdminRead)
def commission_needs_info(
    commission_id: int,
    payload: CommissionNeedsInfoPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommissionRequestAdminRead:
    _require_admin_ops(current_user)
    commission = _get_commission_or_404(db, commission_id)
    if commission.status in {CommissionRequestStatus.REJECTED, CommissionRequestStatus.CONVERTED}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Commission request is closed")

    commission.status = CommissionRequestStatus.NEEDS_INFO
    commission.decided_at = datetime.now(timezone.utc)
    db.add(commission)

    partner_request = PartnerRequest(
        partner_id=commission.partner_id,
        direction=PartnerRequestDirection.INTERNAL_TO_PARTNER,
        request_type=PartnerRequestType.INFO_REQUEST,
        entity_type=PartnerRequestEntityType.COMMISSION_REQUEST,
        entity_id=commission.id,
        status=PartnerRequestStatus.OPEN,
        message=payload.message,
        payload_json=payload.payload_json,
        created_by_user_id=current_user.id,
    )
    db.add(partner_request)

    notify_partner_users(
        db,
        partner_id=commission.partner_id,
        notif_type=NotificationType.PARTNER_REQUEST_NEEDS_INFO,
        message=f"More information requested for {commission.request_code}",
        payload={"commission_request_id": commission.id},
    )

    db.commit()
    db.refresh(commission)
    account_key = resolve_assignment_account_key(
        assignment_id=commission.converted_assignment_id or commission.id,
        partner_id=commission.partner_id,
    )
    studio_billing_adapter.emit_event(
        event_type="commission_cancelled",
        external_account_key=account_key,
        idempotency_key=f"v1:commission_cancelled:{commission.id}",
        payload={
            "commission_request_id": commission.id,
            "status": str(commission.status),
            "decision_reason": commission.decision_reason,
        },
    )
    studio_billing_adapter.release_credits(
        external_key=account_key,
        ref_type="commission_request",
        ref_id=str(commission.id),
        idempotency_key=f"v1:credit_release:commission:{commission.id}",
    )
    return CommissionRequestAdminRead.model_validate(commission)


@router.post("/commissions/{commission_id}/approve", response_model=CommissionRequestAdminRead)
def approve_commission(
    commission_id: int,
    payload: CommissionApprovePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommissionRequestAdminRead:
    _require_admin_ops(current_user)
    commission = _get_commission_or_404(db, commission_id)
    if commission.status not in {CommissionRequestStatus.SUBMITTED, CommissionRequestStatus.NEEDS_INFO}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Commission request not ready for approval")
    if payload.assigned_to_user_id:
        assignee = db.get(User, payload.assigned_to_user_id)
        if not assignee:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assigned_to_user_id")

    assignment_code = generate_assignment_code(db)
    assignment = Assignment(
        assignment_code=assignment_code,
        case_type=CaseType.EXTERNAL_VALUER,
        service_line=payload.service_line or commission.service_line or ServiceLine.VALUATION,
        bank_id=commission.bank_id,
        branch_id=commission.branch_id,
        client_id=commission.client_id,
        property_type_id=commission.property_type_id,
        property_subtype_id=commission.property_subtype_id,
        bank_name=commission.bank_name,
        branch_name=commission.branch_name,
        valuer_client_name=commission.valuer_client_name,
        property_type=commission.property_type,
        borrower_name=commission.borrower_name,
        phone=commission.phone,
        address=commission.address,
        land_area=commission.land_area,
        builtup_area=commission.builtup_area,
        site_visit_date=commission.site_visit_date,
        report_due_date=commission.report_due_date,
        notes=payload.notes or commission.notes,
        created_by_user_id=current_user.id,
        assigned_to_user_id=payload.assigned_to_user_id,
        assigned_at=datetime.now(timezone.utc) if payload.assigned_to_user_id else None,
        status=AssignmentStatus.PENDING,
        fees=payload.fees,
        partner_id=commission.partner_id,
        commission_request_id=commission.id,
    )
    db.add(assignment)
    db.flush()

    if commission.floors:
        floors_payload = [
            {
                "floor_name": floor.floor_name,
                "area": floor.area,
                "order_index": floor.order_index,
            }
            for floor in commission.floors
        ]
        total_area = sync_assignment_floors(db, assignment, floors_payload)
        if total_area is not None:
            assignment.builtup_area = total_area
            db.add(assignment)

    _copy_commission_docs(db, commission, assignment)

    commission.status = CommissionRequestStatus.CONVERTED
    commission.decided_at = datetime.now(timezone.utc)
    commission.converted_assignment_id = assignment.id
    db.add(commission)

    partner_request = PartnerRequest(
        partner_id=commission.partner_id,
        direction=PartnerRequestDirection.INTERNAL_TO_PARTNER,
        request_type=PartnerRequestType.INFO_REQUEST,
        entity_type=PartnerRequestEntityType.ASSIGNMENT,
        entity_id=assignment.id,
        status=PartnerRequestStatus.OPEN,
        message=f"Request approved. Assignment {assignment.assignment_code} is in progress.",
        created_by_user_id=current_user.id,
    )
    db.add(partner_request)

    notify_partner_users(
        db,
        partner_id=commission.partner_id,
        notif_type=NotificationType.PARTNER_REQUEST_APPROVED,
        message=f"Commission approved: {commission.request_code}",
        payload={"commission_request_id": commission.id, "assignment_id": assignment.id},
    )

    db.commit()
    db.refresh(commission)
    account_key = resolve_assignment_account_key(
        assignment_id=assignment.id,
        partner_id=assignment.partner_id,
    )
    studio_billing_adapter.emit_event(
        event_type="work_accepted",
        external_account_key=account_key,
        idempotency_key=f"v1:work_accepted:commission:{commission.id}",
        payload={
            "commission_request_id": commission.id,
            "assignment_id": assignment.id,
            "assignment_code": assignment.assignment_code,
            "fees": str(assignment.fees) if assignment.fees is not None else None,
        },
    )
    billing_status = studio_billing_adapter.get_billing_status(account_key)
    if str(billing_status.get("billing_mode", "")).lower() == "credit":
        studio_billing_adapter.reserve_credits(
            external_key=account_key,
            amount=1,
            ref_type="commission_request",
            ref_id=str(commission.id),
            idempotency_key=f"v1:credit_reserve:commission:{commission.id}",
        )
    return CommissionRequestAdminRead.model_validate(commission)


@router.post("/commissions/{commission_id}/reject", response_model=CommissionRequestAdminRead)
def reject_commission(
    commission_id: int,
    payload: CommissionRejectPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommissionRequestAdminRead:
    _require_admin_ops(current_user)
    commission = _get_commission_or_404(db, commission_id)
    if commission.status in {CommissionRequestStatus.REJECTED, CommissionRequestStatus.CONVERTED}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Commission request is already closed")
    commission.status = CommissionRequestStatus.REJECTED
    commission.decided_at = datetime.now(timezone.utc)
    commission.decision_reason = payload.reason
    db.add(commission)

    partner_request = PartnerRequest(
        partner_id=commission.partner_id,
        direction=PartnerRequestDirection.INTERNAL_TO_PARTNER,
        request_type=PartnerRequestType.INFO_REQUEST,
        entity_type=PartnerRequestEntityType.COMMISSION_REQUEST,
        entity_id=commission.id,
        status=PartnerRequestStatus.OPEN,
        message=payload.reason,
        created_by_user_id=current_user.id,
    )
    db.add(partner_request)

    notify_partner_users(
        db,
        partner_id=commission.partner_id,
        notif_type=NotificationType.PARTNER_REQUEST_REJECTED,
        message=f"Commission rejected: {commission.request_code}",
        payload={"commission_request_id": commission.id},
    )

    db.commit()
    db.refresh(commission)
    return CommissionRequestAdminRead.model_validate(commission)


@router.post("/partner-requests", response_model=PartnerRequestRead, status_code=status.HTTP_201_CREATED)
def create_partner_request(
    payload: PartnerRequestAdminCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PartnerRequestRead:
    _require_finance_or_admin(current_user)
    _ensure_partner_exists(db, payload.partner_id)
    if payload.entity_type == PartnerRequestEntityType.COMMISSION_REQUEST:
        commission = db.get(CommissionRequest, payload.entity_id)
        if not commission or commission.partner_id != payload.partner_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid commission request")
    elif payload.entity_type == PartnerRequestEntityType.ASSIGNMENT:
        assignment = db.get(Assignment, payload.entity_id)
        if not assignment or assignment.partner_id != payload.partner_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assignment")
    elif payload.entity_type == PartnerRequestEntityType.INVOICE:
        invoice = db.get(Invoice, payload.entity_id)
        if not invoice or invoice.partner_id != payload.partner_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid invoice")
    request = PartnerRequest(
        partner_id=payload.partner_id,
        direction=PartnerRequestDirection.INTERNAL_TO_PARTNER,
        request_type=payload.request_type,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        status=PartnerRequestStatus.OPEN,
        message=payload.message,
        payload_json=payload.payload_json,
        created_by_user_id=current_user.id,
    )
    db.add(request)
    db.flush()

    if payload.request_type == PartnerRequestType.PAYMENT_REQUESTED:
        notif_type = NotificationType.PARTNER_PAYMENT_REQUESTED
    elif payload.request_type == PartnerRequestType.DOC_REQUEST:
        notif_type = NotificationType.PARTNER_DOC_REQUESTED
    else:
        notif_type = NotificationType.PARTNER_REQUEST_NEEDS_INFO

    notify_partner_users(
        db,
        partner_id=payload.partner_id,
        notif_type=notif_type,
        message=payload.message,
        payload={"partner_request_id": request.id},
    )

    db.commit()
    db.refresh(request)
    return PartnerRequestRead.model_validate(request)


@router.get("/partner-requests", response_model=list[PartnerRequestRead])
def list_partner_requests(
    partner_id: int | None = Query(None),
    status_filter: PartnerRequestStatus | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[PartnerRequestRead]:
    _require_finance_or_admin(current_user)
    query = db.query(PartnerRequest)
    if partner_id:
        query = query.filter(PartnerRequest.partner_id == partner_id)
    if status_filter:
        query = query.filter(PartnerRequest.status == status_filter)
    rows = query.order_by(PartnerRequest.created_at.desc()).all()
    return [PartnerRequestRead.model_validate(row) for row in rows]


@router.get("/partner-requests/{request_id}/attachments", response_model=list[PartnerRequestAttachmentRead])
def list_partner_request_attachments(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[PartnerRequestAttachmentRead]:
    _require_finance_or_admin(current_user)
    request = db.get(PartnerRequest, request_id)
    if not request:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Partner request not found")
    attachments = (
        db.query(PartnerRequestAttachment)
        .filter(PartnerRequestAttachment.partner_request_id == request.id)
        .order_by(PartnerRequestAttachment.created_at.asc())
        .all()
    )
    return [PartnerRequestAttachmentRead.model_validate(row) for row in attachments]


@router.get("/partner-requests/attachments/{attachment_id}/download")
def download_partner_request_attachment(
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_finance_or_admin(current_user)
    attachment = db.get(PartnerRequestAttachment, attachment_id)
    if not attachment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    path = Path(attachment.storage_path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stored file missing")
    return FileResponse(path=path, filename=attachment.original_name, media_type=attachment.mime_type)


@router.post("/assignments/{assignment_id}/deliverables/release", response_model=PartnerDeliverableRead)
def release_deliverable(
    assignment_id: int,
    payload: PartnerDeliverableReleasePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PartnerDeliverableRead:
    _require_finance_or_admin(current_user)
    assignment = db.get(Assignment, assignment_id)
    if not assignment or assignment.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    if not assignment.partner_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assignment is not partner-linked")
    if not _ensure_invoice_paid(db, assignment.id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invoice not paid")

    document = db.get(AssignmentDocument, payload.document_id)
    if not document or document.assignment_id != assignment.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if not document.is_final:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Document must be marked final")

    deliverable = (
        db.query(PartnerDeliverable)
        .filter(
            PartnerDeliverable.assignment_id == assignment.id,
            PartnerDeliverable.document_id == document.id,
        )
        .first()
    )
    if not deliverable:
        deliverable = PartnerDeliverable(
            partner_id=assignment.partner_id,
            assignment_id=assignment.id,
            document_id=document.id,
        )
    else:
        deliverable.partner_id = assignment.partner_id
    deliverable.released_at = datetime.now(timezone.utc)
    deliverable.released_by_user_id = current_user.id
    db.add(deliverable)
    db.flush()

    partner_request = PartnerRequest(
        partner_id=assignment.partner_id,
        direction=PartnerRequestDirection.INTERNAL_TO_PARTNER,
        request_type=PartnerRequestType.FINAL_REPORT_RELEASED,
        entity_type=PartnerRequestEntityType.ASSIGNMENT,
        entity_id=assignment.id,
        status=PartnerRequestStatus.OPEN,
        message=f"Final report released for assignment {assignment.assignment_code}",
        created_by_user_id=current_user.id,
    )
    db.add(partner_request)

    notify_partner_users(
        db,
        partner_id=assignment.partner_id,
        notif_type=NotificationType.PARTNER_DELIVERABLE_RELEASED,
        message=f"Final report released for {assignment.assignment_code}",
        payload={"assignment_id": assignment.id, "deliverable_id": deliverable.id},
    )

    db.commit()
    db.refresh(deliverable)
    studio_billing_adapter.emit_event(
        event_type="deliverables_released",
        external_account_key=resolve_assignment_account_key(
            assignment_id=assignment.id,
            partner_id=assignment.partner_id,
        ),
        idempotency_key=f"v1:deliverables_released:{deliverable.id}",
        payload={
            "assignment_id": assignment.id,
            "assignment_code": assignment.assignment_code,
            "document_id": document.id,
            "deliverable_id": deliverable.id,
            "released_at": deliverable.released_at.isoformat() if deliverable.released_at else None,
        },
    )
    if assignment.commission_request_id:
        studio_billing_adapter.consume_credits(
            external_key=resolve_assignment_account_key(
                assignment_id=assignment.id,
                partner_id=assignment.partner_id,
            ),
            ref_type="commission_request",
            ref_id=str(assignment.commission_request_id),
            idempotency_key=f"v1:credit_consume:deliverable:{deliverable.id}",
        )
    return PartnerDeliverableRead(
        id=deliverable.id,
        assignment_id=deliverable.assignment_id,
        document_id=deliverable.document_id,
        released_at=deliverable.released_at,
        original_name=document.original_name,
    )


@router.get("/assignments/{assignment_id}/deliverables", response_model=list[PartnerDeliverableRead])
def list_assignment_deliverables(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[PartnerDeliverableRead]:
    _require_finance_or_admin(current_user)
    deliverables = (
        db.query(PartnerDeliverable)
        .filter(PartnerDeliverable.assignment_id == assignment_id)
        .order_by(PartnerDeliverable.created_at.desc())
        .all()
    )
    result: list[PartnerDeliverableRead] = []
    for item in deliverables:
        original_name = item.document.original_name if item.document else None
        result.append(
            PartnerDeliverableRead(
                id=item.id,
                assignment_id=item.assignment_id,
                document_id=item.document_id,
                released_at=item.released_at,
                original_name=original_name,
            )
        )
    return result


@router.get("/partners", response_model=list[PartnerSummaryRead])
def list_partners_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[PartnerSummaryRead]:
    _require_admin_ops(current_user)
    partners = db.query(ExternalPartner).order_by(ExternalPartner.display_name.asc()).all()
    result: list[PartnerSummaryRead] = []
    for partner in partners:
        commission_count = db.query(CommissionRequest).filter(CommissionRequest.partner_id == partner.id).count()
        converted_count = (
            db.query(CommissionRequest)
            .filter(
                CommissionRequest.partner_id == partner.id,
                CommissionRequest.status == CommissionRequestStatus.CONVERTED,
            )
            .count()
        )
        invoices = db.query(Invoice).filter(Invoice.partner_id == partner.id).all()
        unpaid_total = sum((inv.amount_due for inv in invoices if inv.amount_due), Decimal("0.00"))
        last_commission = (
            db.query(CommissionRequest)
            .filter(CommissionRequest.partner_id == partner.id)
            .order_by(CommissionRequest.updated_at.desc())
            .first()
        )
        last_activity_at = last_commission.updated_at if last_commission else None
        summary = PartnerSummaryRead.model_validate(partner)
        summary.commission_count = commission_count
        summary.converted_count = converted_count
        summary.unpaid_total = unpaid_total
        summary.last_activity_at = last_activity_at
        result.append(summary)
    return result
