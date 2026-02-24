from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.deps import get_current_user
from app.core.settings import settings
from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.document import AssignmentDocument
from app.models.enums import (
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
from app.models.master import Bank, Branch, Client, PropertySubtype, PropertyType
from app.models.notification import Notification
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
    CommissionRequestCreate,
    CommissionRequestRead,
    CommissionRequestSummary,
    CommissionRequestUpdate,
    CommissionRequestDocumentRead,
    ExternalPartnerRead,
    PartnerAssignmentDetail,
    PartnerAssignmentSummary,
    PartnerDeliverableRead,
    PartnerInvoiceDetail,
    PartnerInvoiceSummary,
    PartnerRequestAttachmentRead,
    PartnerRequestRead,
    PartnerRequestRespondPayload,
)
from app.schemas.notification import NotificationRead
from app.services.assignments import validate_property_subtype
from app.services.commissions import generate_commission_code, sync_commission_floors
from app.services.notifications import notify_roles

router = APIRouter(prefix="/api/partner", tags=["partner"])


def _require_partner_user(user: User) -> None:
    if not rbac.user_has_role(user, Role.EXTERNAL_PARTNER) or not user.partner_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised for partner portal")


def _get_partner(db: Session, user: User) -> ExternalPartner:
    _require_partner_user(user)
    partner = db.get(ExternalPartner, user.partner_id)
    if not partner or not partner.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Partner account inactive")
    return partner


def _get_commission_or_404(db: Session, commission_id: int, partner_id: int) -> CommissionRequest:
    commission = db.get(CommissionRequest, commission_id)
    if not commission or commission.partner_id != partner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Commission request not found")
    return commission


def _commission_upload_dir(commission: CommissionRequest) -> Path:
    base = settings.ensure_uploads_dir()
    path = base / "commissions" / commission.request_code
    path.mkdir(parents=True, exist_ok=True)
    return path


def _partner_request_upload_dir(request: PartnerRequest) -> Path:
    base = settings.ensure_uploads_dir()
    path = base / "partner_requests" / str(request.partner_id) / str(request.id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _validate_refs(
    db: Session,
    payload: CommissionRequestCreate | CommissionRequestUpdate,
) -> None:
    if payload.bank_id:
        if not db.get(Bank, payload.bank_id):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid bank_id")
    if payload.branch_id:
        if not db.get(Branch, payload.branch_id):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid branch_id")
    if payload.client_id:
        if not db.get(Client, payload.client_id):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid client_id")
    if payload.property_type_id:
        if not db.get(PropertyType, payload.property_type_id):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid property_type_id")
    if payload.property_subtype_id:
        if not db.get(PropertySubtype, payload.property_subtype_id):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid property_subtype_id")
    validate_property_subtype(
        db,
        property_type_id=payload.property_type_id,
        property_subtype_id=payload.property_subtype_id,
    )


def _validate_service_line(partner: ExternalPartner, service_line: ServiceLine | str | None) -> None:
    if not service_line:
        return
    allowed = partner.service_lines or []
    if not allowed:
        return
    value = service_line.value if isinstance(service_line, ServiceLine) else str(service_line)
    if value not in allowed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Service line not available for this partner")


def _apply_name_defaults(db: Session, data: dict) -> None:
    bank_id = data.get("bank_id")
    if bank_id and not data.get("bank_name"):
        bank = db.get(Bank, bank_id)
        if bank:
            data["bank_name"] = bank.name
    branch_id = data.get("branch_id")
    if branch_id and not data.get("branch_name"):
        branch = db.get(Branch, branch_id)
        if branch:
            data["branch_name"] = branch.name
    client_id = data.get("client_id")
    if client_id and not data.get("valuer_client_name"):
        client = db.get(Client, client_id)
        if client:
            data["valuer_client_name"] = client.name
    property_type_id = data.get("property_type_id")
    if property_type_id and not data.get("property_type"):
        prop = db.get(PropertyType, property_type_id)
        if prop:
            data["property_type"] = prop.name


def _payment_status(db: Session, assignment: Assignment) -> str:
    invoices = (
        db.query(Invoice)
        .filter(Invoice.assignment_id == assignment.id)
        .order_by(Invoice.created_at.desc())
        .all()
    )
    if any(inv.is_paid for inv in invoices):
        return "VERIFIED"

    invoice_ids = [inv.id for inv in invoices]
    proof = None
    if invoice_ids:
        proof = (
            db.query(PartnerRequest)
            .filter(
                PartnerRequest.partner_id == assignment.partner_id,
                PartnerRequest.request_type == PartnerRequestType.PAYMENT_PROOF_SUBMITTED,
                PartnerRequest.entity_type == PartnerRequestEntityType.INVOICE,
                PartnerRequest.entity_id.in_(invoice_ids),
            )
            .order_by(PartnerRequest.created_at.desc())
            .first()
        )
    if proof:
        return "PROOF_SUBMITTED"

    requested_query = db.query(PartnerRequest).filter(
        PartnerRequest.partner_id == assignment.partner_id,
        PartnerRequest.request_type == PartnerRequestType.PAYMENT_REQUESTED,
    )
    if invoice_ids:
        requested_query = requested_query.filter(
            (
                (PartnerRequest.entity_type == PartnerRequestEntityType.INVOICE)
                & (PartnerRequest.entity_id.in_(invoice_ids))
            )
            | (
                (PartnerRequest.entity_type == PartnerRequestEntityType.ASSIGNMENT)
                & (PartnerRequest.entity_id == assignment.id)
            )
        )
    else:
        requested_query = requested_query.filter(
            PartnerRequest.entity_type == PartnerRequestEntityType.ASSIGNMENT,
            PartnerRequest.entity_id == assignment.id,
        )
    requested = requested_query.order_by(PartnerRequest.created_at.desc()).first()
    if requested:
        return "REQUESTED"
    return "NOT_REQUESTED"


def _ensure_assignment_access(db: Session, assignment_id: int, partner_id: int) -> Assignment:
    assignment = db.get(Assignment, assignment_id)
    if not assignment or assignment.is_deleted or assignment.partner_id != partner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return assignment


def _ensure_payment_verified(db: Session, assignment: Assignment) -> None:
    invoices = db.query(Invoice).filter(Invoice.assignment_id == assignment.id).all()
    if not invoices or not any(inv.is_paid for inv in invoices):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Payment verification required")


@router.post("/commissions", response_model=CommissionRequestRead, status_code=status.HTTP_201_CREATED)
def create_commission(
    payload: CommissionRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommissionRequestRead:
    partner = _get_partner(db, current_user)
    _validate_refs(db, payload)
    payload_data = payload.model_dump()
    _validate_service_line(partner, payload_data.get("service_line"))
    floors_payload = payload_data.pop("floors", None)
    _apply_name_defaults(db, payload_data)
    request_code = generate_commission_code(db)
    commission = CommissionRequest(
        request_code=request_code,
        partner_id=partner.id,
        status=CommissionRequestStatus.DRAFT,
        created_by_user_id=current_user.id,
        **payload_data,
    )
    db.add(commission)
    db.flush()

    if floors_payload is not None:
        total_area = sync_commission_floors(db, commission, floors_payload)
        if floors_payload:
            commission.builtup_area = total_area
            db.add(commission)
    db.commit()
    db.refresh(commission)
    return CommissionRequestRead.model_validate(commission)


@router.patch("/commissions/{commission_id}", response_model=CommissionRequestRead)
def update_commission(
    commission_id: int,
    payload: CommissionRequestUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommissionRequestRead:
    partner = _get_partner(db, current_user)
    commission = _get_commission_or_404(db, commission_id, partner.id)
    if commission.status not in {CommissionRequestStatus.DRAFT, CommissionRequestStatus.NEEDS_INFO}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Commission request is locked")
    _validate_refs(db, payload)
    update_data = payload.model_dump(exclude_unset=True)
    update_data.pop("status", None)
    update_data.pop("admin_notes", None)
    update_data.pop("decision_reason", None)
    floors_payload = update_data.pop("floors", None)
    if "service_line" in update_data:
        _validate_service_line(partner, update_data.get("service_line"))
    _apply_name_defaults(db, update_data)
    for field, value in update_data.items():
        setattr(commission, field, value)

    if floors_payload is not None:
        total_area = sync_commission_floors(db, commission, floors_payload)
        if floors_payload:
            commission.builtup_area = total_area
        elif "builtup_area" not in update_data:
            commission.builtup_area = None
    db.add(commission)
    db.commit()
    db.refresh(commission)
    return CommissionRequestRead.model_validate(commission)


@router.post("/commissions/{commission_id}/submit", response_model=CommissionRequestRead)
def submit_commission(
    commission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommissionRequestRead:
    partner = _get_partner(db, current_user)
    commission = _get_commission_or_404(db, commission_id, partner.id)
    if commission.status not in {CommissionRequestStatus.DRAFT, CommissionRequestStatus.NEEDS_INFO}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Commission request cannot be submitted")
    commission.status = CommissionRequestStatus.SUBMITTED
    commission.submitted_at = datetime.now(timezone.utc)
    db.add(commission)

    partner_request = PartnerRequest(
        partner_id=partner.id,
        direction=PartnerRequestDirection.PARTNER_TO_INTERNAL,
        request_type=PartnerRequestType.DOC_SUBMITTED,
        entity_type=PartnerRequestEntityType.COMMISSION_REQUEST,
        entity_id=commission.id,
        status=PartnerRequestStatus.OPEN,
        message=f"Commission request {commission.request_code} submitted",
        created_by_partner_user_id=current_user.id,
    )
    db.add(partner_request)

    notify_roles(
        db,
        roles=[Role.OPS_MANAGER, Role.ADMIN],
        notif_type=NotificationType.PARTNER_REQUEST_SUBMITTED,
        message=f"New commission request submitted: {commission.request_code}",
        payload={"commission_request_id": commission.id, "partner_id": partner.id},
        exclude_user_ids=[current_user.id],
    )

    db.commit()
    db.refresh(commission)
    return CommissionRequestRead.model_validate(commission)


@router.get("/commissions", response_model=list[CommissionRequestSummary])
def list_commissions(
    status_filter: CommissionRequestStatus | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[CommissionRequestSummary]:
    partner = _get_partner(db, current_user)
    query = db.query(CommissionRequest).filter(CommissionRequest.partner_id == partner.id)
    if status_filter:
        query = query.filter(CommissionRequest.status == status_filter)
    rows = query.order_by(CommissionRequest.updated_at.desc()).all()
    return [CommissionRequestSummary.model_validate(row) for row in rows]


@router.get("/commissions/{commission_id}", response_model=CommissionRequestRead)
def get_commission(
    commission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommissionRequestRead:
    partner = _get_partner(db, current_user)
    commission = _get_commission_or_404(db, commission_id, partner.id)
    return CommissionRequestRead.model_validate(commission)


@router.post("/commissions/{commission_id}/uploads", response_model=CommissionRequestDocumentRead, status_code=status.HTTP_201_CREATED)
def upload_commission_document(
    commission_id: int,
    file: UploadFile = File(...),
    category: str | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommissionRequestDocumentRead:
    partner = _get_partner(db, current_user)
    commission = _get_commission_or_404(db, commission_id, partner.id)
    if commission.status not in {
        CommissionRequestStatus.DRAFT,
        CommissionRequestStatus.SUBMITTED,
        CommissionRequestStatus.NEEDS_INFO,
    }:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploads are locked for this request")

    upload_dir = _commission_upload_dir(commission)
    # Sanitize filename to prevent path traversal
    safe_filename = Path(file.filename or "upload.bin").name
    suffix = Path(safe_filename).suffix
    filename = f"{uuid4().hex}{suffix}"
    storage_path = upload_dir / filename
    content = file.file.read()
    storage_path.write_bytes(content)

    document = CommissionRequestDocument(
        commission_request_id=commission.id,
        uploaded_by_user_id=current_user.id,
        original_name=file.filename or filename,
        storage_path=str(storage_path),
        mime_type=file.content_type,
        size=len(content),
        category=category,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return CommissionRequestDocumentRead.model_validate(document)


@router.get("/requests", response_model=list[PartnerRequestRead])
def list_partner_requests(
    status_filter: PartnerRequestStatus | None = Query(None, alias="status"),
    entity_type: PartnerRequestEntityType | None = Query(None),
    entity_id: int | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[PartnerRequestRead]:
    partner = _get_partner(db, current_user)
    query = db.query(PartnerRequest).filter(PartnerRequest.partner_id == partner.id)
    if status_filter:
        query = query.filter(PartnerRequest.status == status_filter)
    if entity_type:
        query = query.filter(PartnerRequest.entity_type == entity_type)
    if entity_id:
        query = query.filter(PartnerRequest.entity_id == entity_id)
    rows = query.order_by(PartnerRequest.created_at.desc()).all()
    return [PartnerRequestRead.model_validate(row) for row in rows]


@router.get("/requests/{request_id}/attachments", response_model=list[PartnerRequestAttachmentRead])
def list_partner_request_attachments(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[PartnerRequestAttachmentRead]:
    partner = _get_partner(db, current_user)
    request = db.get(PartnerRequest, request_id)
    if not request or request.partner_id != partner.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Partner request not found")
    attachments = (
        db.query(PartnerRequestAttachment)
        .filter(PartnerRequestAttachment.partner_request_id == request.id)
        .order_by(PartnerRequestAttachment.created_at.asc())
        .all()
    )
    return [PartnerRequestAttachmentRead.model_validate(row) for row in attachments]


def _response_type(original_type: PartnerRequestType) -> PartnerRequestType:
    if original_type == PartnerRequestType.DOC_REQUEST:
        return PartnerRequestType.DOC_SUBMITTED
    if original_type == PartnerRequestType.PAYMENT_REQUESTED:
        return PartnerRequestType.PAYMENT_PROOF_SUBMITTED
    return PartnerRequestType.INFO_REQUEST


def _notify_internal_for_response(
    db: Session,
    response_type: PartnerRequestType,
    partner: ExternalPartner,
    request: PartnerRequest,
) -> None:
    if response_type == PartnerRequestType.PAYMENT_PROOF_SUBMITTED:
        roles = [Role.FINANCE, Role.ADMIN]
        notif_type = NotificationType.PARTNER_PAYMENT_PROOF_SUBMITTED
    elif response_type == PartnerRequestType.DOC_SUBMITTED:
        roles = [Role.OPS_MANAGER, Role.ADMIN]
        notif_type = NotificationType.PARTNER_DOC_SUBMITTED
    else:
        roles = [Role.OPS_MANAGER, Role.ADMIN]
        notif_type = NotificationType.PARTNER_DOC_SUBMITTED
    notify_roles(
        db,
        roles=roles,
        notif_type=notif_type,
        message=f"Partner {partner.display_name} responded: {response_type}",
        payload={"partner_id": partner.id, "partner_request_id": request.id},
    )


@router.post("/requests/{request_id}/respond", response_model=PartnerRequestRead)
def respond_to_request(
    request_id: int,
    payload: PartnerRequestRespondPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PartnerRequestRead:
    partner = _get_partner(db, current_user)
    original = db.get(PartnerRequest, request_id)
    if not original or original.partner_id != partner.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Partner request not found")
    if original.direction != PartnerRequestDirection.INTERNAL_TO_PARTNER:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request is not awaiting partner response")
    if original.status != PartnerRequestStatus.OPEN:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request is already closed")

    response_type = _response_type(original.request_type)
    response = PartnerRequest(
        partner_id=partner.id,
        direction=PartnerRequestDirection.PARTNER_TO_INTERNAL,
        request_type=response_type,
        entity_type=original.entity_type,
        entity_id=original.entity_id,
        status=PartnerRequestStatus.OPEN,
        message=payload.message,
        created_by_partner_user_id=current_user.id,
    )
    db.add(response)

    original.status = PartnerRequestStatus.RESPONDED
    original.closed_at = datetime.now(timezone.utc)
    db.add(original)

    _notify_internal_for_response(db, response_type, partner, original)

    db.commit()
    db.refresh(response)
    return PartnerRequestRead.model_validate(response)


@router.post("/requests/{request_id}/uploads", response_model=PartnerRequestAttachmentRead, status_code=status.HTTP_201_CREATED)
def upload_partner_request_document(
    request_id: int,
    file: UploadFile = File(...),
    message: str | None = Form(default=None),
    category: str | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PartnerRequestAttachmentRead:
    partner = _get_partner(db, current_user)
    original = db.get(PartnerRequest, request_id)
    if not original or original.partner_id != partner.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Partner request not found")
    if original.direction != PartnerRequestDirection.INTERNAL_TO_PARTNER:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request is not awaiting partner response")
    if original.status != PartnerRequestStatus.OPEN:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request is already closed")

    response_type = _response_type(original.request_type)
    response = PartnerRequest(
        partner_id=partner.id,
        direction=PartnerRequestDirection.PARTNER_TO_INTERNAL,
        request_type=response_type,
        entity_type=original.entity_type,
        entity_id=original.entity_id,
        status=PartnerRequestStatus.OPEN,
        message=message or "Files uploaded",
        created_by_partner_user_id=current_user.id,
    )
    db.add(response)
    db.flush()

    upload_dir = _partner_request_upload_dir(response)
    # Sanitize filename to prevent path traversal
    safe_filename = Path(file.filename or "upload.bin").name
    suffix = Path(safe_filename).suffix
    filename = f"{uuid4().hex}{suffix}"
    storage_path = upload_dir / filename
    content = file.file.read()
    storage_path.write_bytes(content)

    attachment = PartnerRequestAttachment(
        partner_request_id=response.id,
        uploaded_by_partner_user_id=current_user.id,
        original_name=file.filename or filename,
        storage_path=str(storage_path),
        mime_type=file.content_type,
        size=len(content),
        category=category,
    )
    db.add(attachment)

    original.status = PartnerRequestStatus.RESPONDED
    original.closed_at = datetime.now(timezone.utc)
    db.add(original)

    _notify_internal_for_response(db, response_type, partner, original)

    db.commit()
    db.refresh(attachment)
    return PartnerRequestAttachmentRead.model_validate(attachment)


@router.get("/assignments", response_model=list[PartnerAssignmentSummary])
def list_partner_assignments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[PartnerAssignmentSummary]:
    partner = _get_partner(db, current_user)
    assignments = (
        db.query(Assignment)
        .filter(Assignment.partner_id == partner.id, Assignment.is_deleted.is_(False))
        .order_by(Assignment.updated_at.desc())
        .all()
    )
    result: list[PartnerAssignmentSummary] = []
    for assignment in assignments:
        result.append(
            PartnerAssignmentSummary(
                id=assignment.id,
                assignment_code=assignment.assignment_code,
                borrower_name=assignment.borrower_name,
                status=str(assignment.status),
                payment_status=_payment_status(db, assignment),
                updated_at=assignment.updated_at,
            )
        )
    return result


@router.get("/assignments/{assignment_id}", response_model=PartnerAssignmentDetail)
def get_partner_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PartnerAssignmentDetail:
    partner = _get_partner(db, current_user)
    assignment = _ensure_assignment_access(db, assignment_id, partner.id)
    return PartnerAssignmentDetail(
        id=assignment.id,
        assignment_code=assignment.assignment_code,
        borrower_name=assignment.borrower_name,
        bank_name=assignment.bank_name,
        branch_name=assignment.branch_name,
        status=str(assignment.status),
        site_visit_date=assignment.site_visit_date,
        report_due_date=assignment.report_due_date,
        payment_status=_payment_status(db, assignment),
    )


@router.get("/invoices", response_model=list[PartnerInvoiceSummary])
def list_partner_invoices(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[PartnerInvoiceSummary]:
    partner = _get_partner(db, current_user)
    invoices = (
        db.query(Invoice)
        .filter(Invoice.partner_id == partner.id)
        .order_by(Invoice.created_at.desc())
        .all()
    )
    return [PartnerInvoiceSummary.model_validate(inv) for inv in invoices]


@router.get("/invoices/{invoice_id}", response_model=PartnerInvoiceDetail)
def get_partner_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PartnerInvoiceDetail:
    partner = _get_partner(db, current_user)
    invoice = db.get(Invoice, invoice_id)
    if not invoice or invoice.partner_id != partner.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
    return PartnerInvoiceDetail.model_validate(invoice)


@router.get("/assignments/{assignment_id}/deliverables", response_model=list[PartnerDeliverableRead])
def list_deliverables(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[PartnerDeliverableRead]:
    partner = _get_partner(db, current_user)
    assignment = _ensure_assignment_access(db, assignment_id, partner.id)
    _ensure_payment_verified(db, assignment)
    deliverables = (
        db.query(PartnerDeliverable)
        .filter(
            PartnerDeliverable.assignment_id == assignment.id,
            PartnerDeliverable.partner_id == partner.id,
            PartnerDeliverable.released_at.is_not(None),
        )
        .order_by(PartnerDeliverable.released_at.desc())
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


@router.get("/deliverables/{deliverable_id}/download")
def download_deliverable(
    deliverable_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    partner = _get_partner(db, current_user)
    deliverable = db.get(PartnerDeliverable, deliverable_id)
    if not deliverable or deliverable.partner_id != partner.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deliverable not found")
    if not deliverable.released_at:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Deliverable not released")

    assignment = _ensure_assignment_access(db, deliverable.assignment_id, partner.id)
    _ensure_payment_verified(db, assignment)

    document = db.get(AssignmentDocument, deliverable.document_id)
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deliverable file missing")
    path = Path(document.storage_path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stored file missing")
    return FileResponse(path=path, filename=document.original_name, media_type=document.mime_type)


@router.get("/notifications", response_model=list[NotificationRead])
def list_partner_notifications(
    unread_only: bool = Query(False),
    include_snoozed: bool = Query(False),
    notif_type: NotificationType | None = Query(None, alias="type"),
    search: str | None = Query(None, max_length=120),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[NotificationRead]:
    partner = _get_partner(db, current_user)
    query = db.query(Notification).filter(Notification.user_id == current_user.id)
    now = datetime.now(timezone.utc)
    if not include_snoozed:
        query = query.filter(
            (Notification.snoozed_until.is_(None)) | (Notification.snoozed_until <= now)
        )
    if unread_only:
        query = query.filter(Notification.read_at.is_(None))
    if notif_type:
        query = query.filter(Notification.type == notif_type)
    if search:
        query = query.filter(Notification.message.ilike(f"%{search}%"))
    notifications = query.order_by(Notification.created_at.desc()).limit(limit).all()
    return [NotificationRead.model_validate(n) for n in notifications]


@router.get("/notifications/unread-count", response_model=dict)
def partner_unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _get_partner(db, current_user)
    now = datetime.now(timezone.utc)
    rows = (
        db.query(Notification)
        .filter(
            Notification.user_id == current_user.id,
            Notification.read_at.is_(None),
            ((Notification.snoozed_until.is_(None)) | (Notification.snoozed_until <= now)),
        )
        .all()
    )
    counts: dict[str, int] = {}
    for n in rows:
        counts[str(n.type)] = counts.get(str(n.type), 0) + 1
    return {"total": sum(counts.values()), "by_type": counts}


@router.post("/notifications/{notification_id}/read", response_model=NotificationRead)
def mark_partner_notification_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> NotificationRead:
    _get_partner(db, current_user)
    notification = db.get(Notification, notification_id)
    if not notification or notification.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    notification.read_at = datetime.now(timezone.utc)
    db.add(notification)
    db.commit()
    db.refresh(notification)
    return NotificationRead.model_validate(notification)


@router.post("/notifications/read-all", response_model=dict)
def mark_partner_notifications_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    _get_partner(db, current_user)
    notifications = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.read_at.is_(None))
        .all()
    )
    now = datetime.now(timezone.utc)
    for notification in notifications:
        notification.read_at = now
        db.add(notification)
    db.commit()
    return {"marked": len(notifications)}


@router.get("/profile", response_model=ExternalPartnerRead)
def get_partner_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ExternalPartnerRead:
    partner = _get_partner(db, current_user)
    return ExternalPartnerRead.model_validate(partner)
