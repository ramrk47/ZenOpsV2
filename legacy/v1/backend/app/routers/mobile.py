from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, joinedload

from app.core import rbac
from app.core.deps import get_current_user
from app.core.settings import settings
from app.db.session import get_db
from app.models.approval import Approval
from app.models.assignment import Assignment
from app.models.audit import ActivityLog
from app.models.document import AssignmentDocument
from app.models.document_comment import CommentLane, DocumentComment
from app.models.enums import (
    ApprovalStatus,
    AssignmentStatus,
    AuthorType,
    DocumentVisibility,
    InvoiceStatus,
    NotificationType,
    PartnerRequestDirection,
    PartnerRequestEntityType,
    PartnerRequestStatus,
    PartnerRequestType,
    Role,
    SupportPriority,
    SupportThreadStatus,
)
from app.models.invoice import Invoice
from app.models.notification import Notification
from app.models.partner import PartnerRequest
from app.models.support import SupportMessage, SupportThread
from app.models.user import User
from app.schemas.mobile import (
    MobileAssignmentDetailResponse,
    MobileAssignmentOverview,
    MobileCommentCreate,
    MobileCommentItem,
    MobileDocumentItem,
    MobileQueueItem,
    MobileRaiseRequestCreate,
    MobileRaiseRequestResponse,
    MobileSummaryResponse,
    MobileTimelineEntry,
)
from app.services.approvals import is_user_eligible_for_approval
from app.services.assignments import (
    apply_access_filter,
    compute_due_info,
    compute_missing_document_categories,
    ensure_assignment_access,
)
from app.services.notifications import create_notification_if_absent, notify_roles
from app.utils.mentions import parse_and_resolve_mentions


router = APIRouter(prefix="/api/mobile", tags=["mobile"])

OPEN_ASSIGNMENT_STATUSES = {
    AssignmentStatus.PENDING,
    AssignmentStatus.SITE_VISIT,
    AssignmentStatus.UNDER_PROCESS,
    AssignmentStatus.SUBMITTED,
}


def _is_partner_user(user: User) -> bool:
    return rbac.user_has_role(user, Role.EXTERNAL_PARTNER) and bool(user.partner_id)


def _assignment_label(assignment: Assignment) -> str | None:
    return assignment.valuer_client_name or assignment.bank_name or assignment.borrower_name


def _queue_item(
    assignment: Assignment,
    *,
    due_state: str,
    due_time: datetime | None,
    payment_pending: bool,
    approval_waiting: bool,
    needs_docs: bool,
) -> MobileQueueItem:
    badges: list[str] = []
    if due_state == "OVERDUE":
        badges.append("OVERDUE")
    if needs_docs:
        badges.append("NEEDS_DOCS")
    if payment_pending:
        badges.append("PAYMENT_PENDING")
    if approval_waiting:
        badges.append("APPROVAL_WAITING")

    if "OVERDUE" in badges:
        next_action = "Resolve overdue items"
    elif "NEEDS_DOCS" in badges:
        next_action = "Upload/collect required documents"
    elif "APPROVAL_WAITING" in badges:
        next_action = "Approval pending"
    elif "PAYMENT_PENDING" in badges:
        next_action = "Follow up payment"
    elif due_state == "DUE_SOON":
        next_action = "Prioritize due-soon work"
    else:
        next_action = "Continue workflow"

    return MobileQueueItem(
        id=assignment.id,
        assignment_code=assignment.assignment_code,
        bank_or_client=_assignment_label(assignment),
        borrower_name=assignment.borrower_name,
        status=str(assignment.status),
        due_time=due_time,
        due_state=due_state,
        updated_at=assignment.updated_at,
        next_action=next_action,
        badges=badges,
    )


def _queue_sort_key(item: MobileQueueItem):
    if item.due_state == "OVERDUE":
        rank = 0
    elif item.due_state == "DUE_SOON":
        rank = 1
    else:
        rank = 2
    due_sort = item.due_time.timestamp() if item.due_time else float("inf")
    return (rank, due_sort, -item.updated_at.timestamp())


def _ensure_mobile_access(db: Session, assignment_id: int, current_user: User) -> Assignment:
    assignment = db.get(Assignment, assignment_id)
    if not assignment or assignment.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")

    if _is_partner_user(current_user):
        if assignment.partner_id != current_user.partner_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
        return assignment

    try:
        ensure_assignment_access(assignment, current_user)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return assignment


def _document_visible_to_partner(document: AssignmentDocument, user: User) -> bool:
    return document.visibility == DocumentVisibility.PARTNER_RELEASED or document.uploaded_by_user_id == user.id


@router.get("/summary", response_model=MobileSummaryResponse)
def mobile_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MobileSummaryResponse:
    partner_mode = _is_partner_user(current_user)
    now = datetime.now(timezone.utc)

    assignment_query = db.query(Assignment).filter(
        Assignment.is_deleted.is_(False),
        Assignment.status.in_(OPEN_ASSIGNMENT_STATUSES),
    )
    if partner_mode:
        assignment_query = assignment_query.filter(Assignment.partner_id == current_user.partner_id)
    else:
        assignment_query = apply_access_filter(assignment_query, current_user)

    assignments = assignment_query.order_by(Assignment.updated_at.desc()).limit(250).all()
    assignment_ids = [a.id for a in assignments]

    invoice_assignment_ids: set[int] = set()
    approval_assignment_ids: set[int] = set()
    if assignment_ids:
        invoice_rows = (
            db.query(Invoice.assignment_id)
            .filter(
                Invoice.assignment_id.in_(assignment_ids),
                Invoice.status.in_(
                    [InvoiceStatus.ISSUED, InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID]
                ),
                Invoice.amount_due > Decimal("0.00"),
            )
            .distinct()
            .all()
        )
        invoice_assignment_ids = {row[0] for row in invoice_rows if row[0]}

        if not partner_mode:
            approval_rows = (
                db.query(Approval.assignment_id)
                .filter(
                    Approval.status == ApprovalStatus.PENDING,
                    Approval.assignment_id.in_(assignment_ids),
                )
                .distinct()
                .all()
            )
            approval_assignment_ids = {row[0] for row in approval_rows if row[0]}

    queue: list[MobileQueueItem] = []
    overdue_assignments = 0
    for assignment in assignments:
        due = compute_due_info(assignment, now=now)
        needs_docs = False if partner_mode else len(compute_missing_document_categories(db, assignment)) > 0
        payment_pending = assignment.id in invoice_assignment_ids
        approval_waiting = (assignment.id in approval_assignment_ids) and not partner_mode
        item = _queue_item(
            assignment,
            due_state=due.due_state,
            due_time=due.due_time,
            payment_pending=payment_pending,
            approval_waiting=approval_waiting,
            needs_docs=needs_docs,
        )
        if item.due_state == "OVERDUE":
            overdue_assignments += 1
        queue.append(item)

    queue = sorted(queue, key=_queue_sort_key)[:20]

    unread_notifications = (
        db.query(Notification)
        .filter(
            Notification.user_id == current_user.id,
            Notification.read_at.is_(None),
            or_(Notification.snoozed_until.is_(None), Notification.snoozed_until <= now),
        )
        .count()
    )

    if partner_mode:
        approvals_pending = 0
    elif rbac.can_approve(current_user):
        pending_approvals = (
            db.query(Approval)
            .filter(Approval.status == ApprovalStatus.PENDING)
            .order_by(Approval.created_at.desc())
            .all()
        )
        approvals_pending = sum(
            1 for approval in pending_approvals if is_user_eligible_for_approval(approval, current_user)
        )
    else:
        approvals_pending = (
            db.query(Approval)
            .filter(
                Approval.requester_user_id == current_user.id,
                Approval.status == ApprovalStatus.PENDING,
            )
            .count()
        )

    return MobileSummaryResponse(
        unread_notifications=unread_notifications,
        approvals_pending=approvals_pending,
        overdue_assignments=overdue_assignments,
        payments_pending=len(invoice_assignment_ids),
        my_queue=queue,
        generated_at=now,
    )


@router.get("/assignments/{assignment_id}", response_model=MobileAssignmentDetailResponse)
def mobile_assignment_detail(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MobileAssignmentDetailResponse:
    assignment = _ensure_mobile_access(db, assignment_id, current_user)
    partner_mode = _is_partner_user(current_user)
    now = datetime.now(timezone.utc)

    due = compute_due_info(assignment, now=now)
    payment_pending = (
        db.query(Invoice.id)
        .filter(
            Invoice.assignment_id == assignment.id,
            Invoice.status.in_([InvoiceStatus.ISSUED, InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID]),
            Invoice.amount_due > Decimal("0.00"),
        )
        .first()
        is not None
    )
    approval_waiting = (
        not partner_mode
        and db.query(Approval.id)
        .filter(Approval.assignment_id == assignment.id, Approval.status == ApprovalStatus.PENDING)
        .first()
        is not None
    )
    needs_docs = False if partner_mode else len(compute_missing_document_categories(db, assignment)) > 0
    overview_item = _queue_item(
        assignment,
        due_state=due.due_state,
        due_time=due.due_time,
        payment_pending=payment_pending,
        approval_waiting=approval_waiting,
        needs_docs=needs_docs,
    )
    overview = MobileAssignmentOverview(**overview_item.model_dump())

    if partner_mode:
        timeline_rows = (
            db.query(PartnerRequest)
            .filter(
                PartnerRequest.partner_id == current_user.partner_id,
                PartnerRequest.entity_type == PartnerRequestEntityType.ASSIGNMENT,
                PartnerRequest.entity_id == assignment.id,
            )
            .order_by(PartnerRequest.created_at.desc())
            .limit(10)
            .all()
        )
        timeline = [
            MobileTimelineEntry(
                id=f"partner-request-{row.id}",
                created_at=row.created_at,
                event_type=str(row.request_type),
                message=row.message or str(row.request_type),
                actor_label="You" if row.created_by_partner_user_id == current_user.id else "Internal Team",
            )
            for row in timeline_rows
        ]
    else:
        timeline_rows = (
            db.query(ActivityLog)
            .options(joinedload(ActivityLog.actor))
            .filter(ActivityLog.assignment_id == assignment.id)
            .order_by(ActivityLog.created_at.desc())
            .limit(10)
            .all()
        )
        timeline = [
            MobileTimelineEntry(
                id=f"activity-{row.id}",
                created_at=row.created_at,
                event_type=row.type,
                message=row.message or row.type,
                actor_label=(row.actor.full_name or row.actor.email) if row.actor else None,
            )
            for row in timeline_rows
        ]

    documents_query = db.query(AssignmentDocument).filter(AssignmentDocument.assignment_id == assignment.id)
    if partner_mode:
        documents_query = documents_query.filter(
            or_(
                AssignmentDocument.visibility == DocumentVisibility.PARTNER_RELEASED,
                AssignmentDocument.uploaded_by_user_id == current_user.id,
            )
        )
    documents_rows = documents_query.order_by(AssignmentDocument.created_at.desc()).all()
    document_ids = [row.id for row in documents_rows]

    comment_counts: dict[int, int] = {}
    if document_ids:
        counts_rows = (
            db.query(DocumentComment.document_id, func.count(DocumentComment.id))
            .filter(DocumentComment.document_id.in_(document_ids))
            .group_by(DocumentComment.document_id)
            .all()
        )
        comment_counts = {row[0]: int(row[1]) for row in counts_rows}

    documents = [
        MobileDocumentItem(
            id=row.id,
            original_name=row.original_name,
            category=row.category,
            mime_type=row.mime_type,
            size=row.size,
            review_status=str(row.review_status),
            visibility=str(row.visibility),
            created_at=row.created_at,
            comments_count=comment_counts.get(row.id, 0),
        )
        for row in documents_rows
    ]

    comments_query = (
        db.query(DocumentComment)
        .options(joinedload(DocumentComment.author))
        .filter(DocumentComment.assignment_id == assignment.id)
    )
    if partner_mode:
        comments_query = comments_query.filter(
            and_(
                DocumentComment.lane == CommentLane.EXTERNAL,
                or_(
                    DocumentComment.is_visible_to_client.is_(True),
                    DocumentComment.author_id == current_user.id,
                ),
            )
        )
    comments_rows = comments_query.order_by(DocumentComment.created_at.desc()).limit(20).all()
    comments = [
        MobileCommentItem(
            id=row.id,
            document_id=row.document_id,
            lane=row.lane.value,
            content=row.content,
            author_label=(row.author.full_name or row.author.email) if row.author else "Unknown",
            created_at=row.created_at,
            is_resolved=row.is_resolved,
        )
        for row in comments_rows
    ]

    return MobileAssignmentDetailResponse(
        overview=overview,
        timeline=timeline,
        documents=documents,
        comments=comments,
        can_upload=True,
        can_comment=True,
        can_raise_request=True,
    )


@router.post("/assignments/{assignment_id}/documents/upload", response_model=MobileDocumentItem, status_code=status.HTTP_201_CREATED)
def mobile_upload_document(
    assignment_id: int,
    file: UploadFile = File(...),
    category: str | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MobileDocumentItem:
    assignment = _ensure_mobile_access(db, assignment_id, current_user)
    partner_mode = _is_partner_user(current_user)

    base = settings.ensure_uploads_dir()
    upload_dir = base / assignment.assignment_code
    upload_dir.mkdir(parents=True, exist_ok=True)

    safe_filename = Path(file.filename or "mobile-upload.bin").name
    suffix = Path(safe_filename).suffix
    stored_name = f"{uuid4().hex}{suffix}"
    storage_path = upload_dir / stored_name
    content = file.file.read()
    storage_path.write_bytes(content)

    version = (
        db.query(AssignmentDocument)
        .filter(
            AssignmentDocument.assignment_id == assignment.id,
            AssignmentDocument.category == category,
        )
        .count()
        + 1
    )
    document = AssignmentDocument(
        assignment_id=assignment.id,
        uploaded_by_user_id=current_user.id,
        original_name=file.filename or stored_name,
        storage_path=str(storage_path),
        mime_type=file.content_type,
        size=len(content),
        category=category,
        version_number=version,
        is_final=False,
        visibility=DocumentVisibility.INTERNAL_ONLY,
    )
    db.add(document)

    if partner_mode:
        partner_request = PartnerRequest(
            partner_id=current_user.partner_id,
            direction=PartnerRequestDirection.PARTNER_TO_INTERNAL,
            request_type=PartnerRequestType.DOC_SUBMITTED,
            entity_type=PartnerRequestEntityType.ASSIGNMENT,
            entity_id=assignment.id,
            status=PartnerRequestStatus.OPEN,
            message=f"Document uploaded via mobile for {assignment.assignment_code}",
            created_by_partner_user_id=current_user.id,
        )
        db.add(partner_request)
        notify_roles(
            db,
            roles=[Role.OPS_MANAGER, Role.ADMIN],
            notif_type=NotificationType.PARTNER_DOC_SUBMITTED,
            message=f"Partner uploaded a document for {assignment.assignment_code}",
            payload={"assignment_id": assignment.id, "partner_id": current_user.partner_id},
            exclude_user_ids=[current_user.id],
        )

    db.commit()
    db.refresh(document)
    return MobileDocumentItem(
        id=document.id,
        original_name=document.original_name,
        category=document.category,
        mime_type=document.mime_type,
        size=document.size,
        review_status=str(document.review_status),
        visibility=str(document.visibility),
        created_at=document.created_at,
        comments_count=0,
    )


@router.post("/assignments/{assignment_id}/comments", response_model=MobileCommentItem, status_code=status.HTTP_201_CREATED)
def mobile_create_comment(
    assignment_id: int,
    payload: MobileCommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MobileCommentItem:
    assignment = _ensure_mobile_access(db, assignment_id, current_user)
    partner_mode = _is_partner_user(current_user)

    document = None
    if payload.document_id:
        document = db.get(AssignmentDocument, payload.document_id)
        if not document or document.assignment_id != assignment.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    else:
        latest_query = db.query(AssignmentDocument).filter(AssignmentDocument.assignment_id == assignment.id)
        if partner_mode:
            latest_query = latest_query.filter(
                or_(
                    AssignmentDocument.visibility == DocumentVisibility.PARTNER_RELEASED,
                    AssignmentDocument.uploaded_by_user_id == current_user.id,
                )
            )
        document = latest_query.order_by(AssignmentDocument.created_at.desc()).first()
        if not document:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload a document before commenting")

    if partner_mode and not _document_visible_to_partner(document, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied for this document")

    if partner_mode:
        lane = CommentLane.EXTERNAL
        is_visible_to_client = True
    else:
        try:
            lane = CommentLane(payload.lane or "INTERNAL")
        except Exception:
            lane = CommentLane.INTERNAL
        is_visible_to_client = bool(payload.is_visible_to_client and lane == CommentLane.EXTERNAL)

    mentioned_user_ids: list[int] = []
    if lane == CommentLane.INTERNAL and not partner_mode:
        mentioned_user_ids, _warnings = parse_and_resolve_mentions(db, payload.content.strip(), current_user.id)

    comment = DocumentComment(
        document_id=document.id,
        assignment_id=assignment.id,
        author_id=current_user.id,
        content=payload.content.strip(),
        lane=lane,
        is_visible_to_client=is_visible_to_client,
    )
    comment.mentioned_users = mentioned_user_ids
    db.add(comment)
    db.commit()
    db.refresh(comment)

    if mentioned_user_ids:
        for user_id in mentioned_user_ids:
            create_notification_if_absent(
                db,
                user_id=user_id,
                notif_type=NotificationType.MENTION,
                message=f"{current_user.full_name or current_user.email} mentioned you in a comment",
                payload={
                    "comment_id": comment.id,
                    "document_id": comment.document_id,
                    "assignment_id": assignment.id,
                },
                within_minutes=5,
            )
        db.commit()

    author_label = current_user.full_name or current_user.email
    return MobileCommentItem(
        id=comment.id,
        document_id=comment.document_id,
        lane=comment.lane.value,
        content=comment.content,
        author_label=author_label,
        created_at=comment.created_at,
        is_resolved=comment.is_resolved,
    )


@router.post("/assignments/{assignment_id}/request", response_model=MobileRaiseRequestResponse, status_code=status.HTTP_201_CREATED)
def mobile_raise_request(
    assignment_id: int,
    payload: MobileRaiseRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MobileRaiseRequestResponse:
    assignment = _ensure_mobile_access(db, assignment_id, current_user)
    partner_mode = _is_partner_user(current_user)

    if partner_mode:
        request = PartnerRequest(
            partner_id=current_user.partner_id,
            direction=PartnerRequestDirection.PARTNER_TO_INTERNAL,
            request_type=PartnerRequestType.INFO_REQUEST,
            entity_type=PartnerRequestEntityType.ASSIGNMENT,
            entity_id=assignment.id,
            status=PartnerRequestStatus.OPEN,
            message=payload.message.strip(),
            created_by_partner_user_id=current_user.id,
        )
        db.add(request)
        notify_roles(
            db,
            roles=[Role.OPS_MANAGER, Role.ADMIN],
            notif_type=NotificationType.PARTNER_REQUEST_SUBMITTED,
            message=f"New partner request for {assignment.assignment_code}",
            payload={"assignment_id": assignment.id, "partner_id": current_user.partner_id},
            exclude_user_ids=[current_user.id],
        )
        db.commit()
        db.refresh(request)
        return MobileRaiseRequestResponse(kind="partner_request", id=request.id, status=request.status.value)

    priority_map = {
        "LOW": SupportPriority.LOW,
        "MEDIUM": SupportPriority.MEDIUM,
        "HIGH": SupportPriority.HIGH,
        "URGENT": SupportPriority.URGENT,
    }
    thread = SupportThread(
        assignment_id=assignment.id,
        created_by_user_id=current_user.id,
        created_via=AuthorType.INTERNAL,
        status=SupportThreadStatus.OPEN,
        priority=priority_map.get(payload.priority.upper(), SupportPriority.MEDIUM),
        subject=(payload.subject or f"Mobile request - {assignment.assignment_code}").strip(),
    )
    db.add(thread)
    db.flush()

    message = SupportMessage(
        thread_id=thread.id,
        author_user_id=current_user.id,
        author_type=AuthorType.INTERNAL,
        author_label=current_user.full_name or current_user.email,
        message_text=payload.message.strip(),
    )
    db.add(message)
    thread.last_message_at = datetime.now(timezone.utc)
    db.add(thread)
    db.commit()
    db.refresh(thread)

    return MobileRaiseRequestResponse(kind="support_thread", id=thread.id, status=thread.status.value)
