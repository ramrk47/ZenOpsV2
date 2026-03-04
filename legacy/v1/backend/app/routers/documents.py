from __future__ import annotations

from datetime import datetime
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.approval import Approval
from app.models.assignment import Assignment
from app.models.document import AssignmentDocument
from app.models.document_comment import CommentLane, DocumentComment
from app.models.enums import (
    ApprovalActionType,
    ApprovalEntityType,
    ApprovalStatus,
    ApprovalType,
    DocumentReviewStatus,
    DocumentVisibility,
    NotificationType,
    Role,
)
from app.models.user import User
from app.schemas.document import DocumentRead, DocumentReviewPayload, DocumentReviewResponse, MarkFinalPayload
from app.services.activity import log_activity
from app.services.approvals import request_approval, required_roles_for_approval
from app.services.assignments import compute_missing_document_categories, ensure_assignment_access
from app.services.notifications import create_notification, create_notification_if_absent, notify_roles
from app.services.upload_security import UploadSecurityError, build_upload_subdir, store_upload_file
from app.services.v1_outbox import enqueue_v1_outbox_event
from app.utils.mentions import parse_and_resolve_mentions

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assignments/{assignment_id}/documents", tags=["documents"])


def _get_assignment_or_404(db: Session, assignment_id: int) -> Assignment:
    assignment = db.get(Assignment, assignment_id)
    if not assignment or assignment.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return assignment


def _require_access(assignment: Assignment, user: User) -> None:
    try:
        ensure_assignment_access(assignment, user)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


def _assignment_upload_dir(assignment: Assignment) -> Path:
    return build_upload_subdir(assignment.assignment_code)


def _next_version(db: Session, assignment_id: int, category: str | None) -> int:
    query = db.query(AssignmentDocument).filter(AssignmentDocument.assignment_id == assignment_id)
    if category:
        query = query.filter(AssignmentDocument.category == category)
    return query.count() + 1


def _request_final_document_approval(
    db: Session,
    *,
    assignment: Assignment,
    document: AssignmentDocument,
    current_user: User,
) -> Approval:
    existing = (
        db.query(Approval)
        .filter(
            Approval.status == ApprovalStatus.PENDING,
            Approval.approval_type == ApprovalType.FINAL_DOC_REVIEW,
            Approval.entity_type == ApprovalEntityType.DOCUMENT,
            Approval.entity_id == document.id,
        )
        .first()
    )
    if existing:
        return existing

    approval = Approval(
        approval_type=ApprovalType.FINAL_DOC_REVIEW,
        entity_type=ApprovalEntityType.DOCUMENT,
        entity_id=document.id,
        action_type=ApprovalActionType.FINAL_REVIEW,
        requester_user_id=current_user.id,
        approver_user_id=None,
        status=ApprovalStatus.PENDING,
        reason="Final document submitted for review approval",
        payload_json={"assignment_id": assignment.id, "document_id": document.id},
        metadata_json={
            "assignment_code": assignment.assignment_code,
            "document_name": document.original_name,
            "category": document.category,
        },
        assignment_id=assignment.id,
    )
    allowed_roles = required_roles_for_approval(approval.entity_type, approval.action_type, approval.approval_type)
    request_approval(db, approval=approval, allowed_roles=allowed_roles, auto_assign=False)
    notify_roles(
        db,
        roles=allowed_roles,
        notif_type=NotificationType.APPROVAL_PENDING,
        message="Final document review approval requested",
        payload={"approval_id": approval.id, "assignment_id": assignment.id, "document_id": document.id},
        exclude_user_ids=[current_user.id],
    )
    return approval


@router.get("", response_model=list[DocumentRead])
def list_documents(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[DocumentRead]:
    assignment = _get_assignment_or_404(db, assignment_id)
    _require_access(assignment, current_user)
    
    # Fetch documents with comment counts
    documents = (
        db.query(
            AssignmentDocument,
            func.count(DocumentComment.id).label('comments_count'),
            func.count(func.nullif(DocumentComment.is_resolved, True)).label('unresolved_count'),
            func.max(DocumentComment.created_at).label('last_commented_at')
        )
        .outerjoin(DocumentComment, DocumentComment.document_id == AssignmentDocument.id)
        .filter(AssignmentDocument.assignment_id == assignment_id)
        .group_by(AssignmentDocument.id)
        .order_by(AssignmentDocument.created_at.asc())
        .all()
    )
    
    # Filter based on user role (EXTERNAL_PARTNER can only see PARTNER_RELEASED or own uploads)
    filtered_docs = []
    for doc, comments_count, unresolved_count, last_commented_at in documents:
        if current_user.role == Role.EXTERNAL_PARTNER:
            # Partners can only see PARTNER_RELEASED docs or docs they uploaded
            if doc.visibility != DocumentVisibility.PARTNER_RELEASED and doc.uploaded_by_user_id != current_user.id:
                continue
        
        # Create response with aggregated metadata
        doc_read = DocumentRead.model_validate(doc)
        doc_read.comments_count = comments_count or 0
        doc_read.unresolved_count = unresolved_count or 0
        doc_read.last_commented_at = last_commented_at
        filtered_docs.append(doc_read)
    
    return filtered_docs


@router.post("/upload", response_model=DocumentRead, status_code=status.HTTP_201_CREATED)
def upload_document(
    assignment_id: int,
    file: UploadFile = File(...),
    category: str | None = Form(default=None),
    is_final: bool = Form(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentRead:
    assignment = _get_assignment_or_404(db, assignment_id)
    _require_access(assignment, current_user)

    upload_dir = _assignment_upload_dir(assignment)
    try:
        stored = store_upload_file(file, destination_dir=upload_dir)
    except UploadSecurityError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"code": exc.code, "message": exc.message},
        ) from exc

    version = _next_version(db, assignment_id, category)

    document = AssignmentDocument(
        assignment_id=assignment_id,
        uploaded_by_user_id=current_user.id,
        original_name=stored.original_name,
        storage_path=stored.storage_path,
        mime_type=stored.mime_type,
        size=stored.size,
        category=category,
        version_number=version,
        is_final=False,
    )
    db.add(document)
    db.flush()

    if is_final:
        document.review_status = DocumentReviewStatus.FINAL_PENDING_APPROVAL
        db.add(document)
        approval = _request_final_document_approval(
            db,
            assignment=assignment,
            document=document,
            current_user=current_user,
        )
        log_activity(
            db,
            actor_user_id=current_user.id,
            activity_type="DOCUMENT_FINAL_REVIEW_REQUESTED",
            assignment_id=assignment_id,
            message=document.original_name,
            payload={"document_id": document.id, "approval_id": approval.id},
        )

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="DOCUMENT_UPLOADED",
        assignment_id=assignment_id,
        message=document.original_name,
        payload={"document_id": document.id, "category": document.category},
    )

    missing = compute_missing_document_categories(db, assignment)
    if missing and assignment.assigned_to_user_id:
        create_notification(
            db,
            user_id=assignment.assigned_to_user_id,
            notif_type=NotificationType.MISSING_DOC,
            message=f"Still missing: {', '.join(missing[:4])}",
            payload={"assignment_id": assignment.id, "missing": missing},
        )

    enqueue_v1_outbox_event(
        db,
        event_type="evidence.upsert",
        payload={
            "assignment_id": assignment.id,
            "assignment_code": assignment.assignment_code,
            "document_id": document.id,
            "category": document.category,
            "storage_path": document.storage_path,
            "mime_type": document.mime_type,
            "is_final": document.is_final,
        },
    )

    db.commit()
    db.refresh(document)
    return DocumentRead.model_validate(document)


@router.post("/{document_id}/final", response_model=DocumentRead)
def mark_document_final(
    assignment_id: int,
    document_id: int,
    payload: MarkFinalPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentRead:
    assignment = _get_assignment_or_404(db, assignment_id)
    _require_access(assignment, current_user)

    document = db.get(AssignmentDocument, document_id)
    if not document or document.assignment_id != assignment_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    if payload.is_final:
        document.is_final = False
        document.review_status = DocumentReviewStatus.FINAL_PENDING_APPROVAL
        approval = _request_final_document_approval(
            db,
            assignment=assignment,
            document=document,
            current_user=current_user,
        )
        log_activity(
            db,
            actor_user_id=current_user.id,
            activity_type="DOCUMENT_FINAL_REVIEW_REQUESTED",
            assignment_id=assignment_id,
            payload={"document_id": document.id, "approval_id": approval.id},
        )
    else:
        document.is_final = False
        if document.review_status in {DocumentReviewStatus.FINAL, DocumentReviewStatus.FINAL_PENDING_APPROVAL}:
            document.review_status = DocumentReviewStatus.REVIEWED
        log_activity(
            db,
            actor_user_id=current_user.id,
            activity_type="DOCUMENT_FINAL_FLAGGED",
            assignment_id=assignment_id,
            payload={"document_id": document.id, "is_final": document.is_final},
        )
    db.add(document)

    enqueue_v1_outbox_event(
        db,
        event_type="evidence.upsert",
        payload={
            "assignment_id": assignment.id,
            "assignment_code": assignment.assignment_code,
            "document_id": document.id,
            "category": document.category,
            "storage_path": document.storage_path,
            "mime_type": document.mime_type,
            "is_final": document.is_final,
        },
    )

    db.commit()
    db.refresh(document)
    return DocumentRead.model_validate(document)


@router.get("/{document_id}/download")
def download_document(
    assignment_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    assignment = _get_assignment_or_404(db, assignment_id)
    _require_access(assignment, current_user)

    document = db.get(AssignmentDocument, document_id)
    if not document or document.assignment_id != assignment_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    
    # Permission check for EXTERNAL_PARTNER
    if current_user.role == Role.EXTERNAL_PARTNER:
        if document.visibility != DocumentVisibility.PARTNER_RELEASED and document.uploaded_by_user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    path = Path(document.storage_path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stored file missing")

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="DOCUMENT_DOWNLOADED",
        assignment_id=assignment_id,
        payload={"document_id": document.id},
    )
    db.commit()

    # Sanitize filename for HTTP header (ASCII only)
    safe_filename = document.original_name.encode('ascii', 'ignore').decode('ascii') or 'document'
    return FileResponse(path=path, filename=safe_filename, media_type=document.mime_type)


@router.api_route("/{document_id}/preview", methods=["GET", "HEAD"])
def preview_document(
    assignment_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Preview document inline (image/PDF viewable in browser)."""
    assignment = _get_assignment_or_404(db, assignment_id)
    _require_access(assignment, current_user)

    document = db.get(AssignmentDocument, document_id)
    if not document or document.assignment_id != assignment_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    
    # Permission check for EXTERNAL_PARTNER
    if current_user.role == Role.EXTERNAL_PARTNER:
        if document.visibility != DocumentVisibility.PARTNER_RELEASED and document.uploaded_by_user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    path = Path(document.storage_path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stored file missing")

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="DOCUMENT_VIEWED",
        assignment_id=assignment_id,
        payload={"document_id": document.id},
    )
    db.commit()

    # Sanitize filename for HTTP header (ASCII only)
    safe_filename = document.original_name.encode('ascii', 'ignore').decode('ascii') or 'document'

    # Return file with inline disposition for browser preview
    return FileResponse(
        path=path,
        filename=safe_filename,
        media_type=document.mime_type,
        headers={"Content-Disposition": f'inline; filename="{safe_filename}"'}
    )


@router.post("/{document_id}/review", response_model=DocumentReviewResponse)
async def review_document(
    assignment_id: int,
    document_id: int,
    payload: DocumentReviewPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DocumentReviewResponse:
    """One-shot review: update status + optionally add comment with @mention parsing."""
    assignment = _get_assignment_or_404(db, assignment_id)
    _require_access(assignment, current_user)
    
    # Only internal roles can review
    if current_user.role == Role.EXTERNAL_PARTNER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Partners cannot review documents")

    document = db.get(AssignmentDocument, document_id)
    if not document or document.assignment_id != assignment_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    # Validate review status
    try:
        new_status = DocumentReviewStatus(payload.review_status)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid review_status: {payload.review_status}"
        )

    # Update document
    if new_status == DocumentReviewStatus.FINAL:
        document.review_status = DocumentReviewStatus.FINAL_PENDING_APPROVAL
        document.is_final = False
        _request_final_document_approval(
            db,
            assignment=assignment,
            document=document,
            current_user=current_user,
        )
    else:
        document.review_status = new_status
    document.reviewed_by_user_id = current_user.id
    document.reviewed_at = datetime.utcnow()
    db.add(document)

    # Create comment if note provided
    comment_id = None
    comment_created = False
    if payload.note and payload.note.strip():
        # Validate lane
        try:
            lane = CommentLane(payload.lane)
        except ValueError:
            lane = CommentLane.INTERNAL
        
        # Parse mentions from note
        mentioned_user_ids, mention_warnings = parse_and_resolve_mentions(
            db, payload.note.strip(), current_user.id
        )
        
        comment = DocumentComment(
            document_id=document.id,
            assignment_id=assignment_id,
            author_id=current_user.id,
            content=payload.note.strip(),
            lane=lane,
            is_visible_to_client=payload.is_visible_to_client and lane == CommentLane.EXTERNAL,
        )
        comment.mentioned_users = mentioned_user_ids
        db.add(comment)
        db.flush()
        comment_id = comment.id
        comment_created = True

        # Send notifications to mentioned users
        if mentioned_user_ids:
            logger.info(
                f"Mentioned users in review comment {comment.id}: {mentioned_user_ids}"
            )
            for user_id in mentioned_user_ids:
                try:
                    create_notification_if_absent(
                        db,
                        user_id=user_id,
                        notif_type=NotificationType.MENTION,
                        message=f"{current_user.full_name or current_user.email} mentioned you in a review",
                        payload={
                            "comment_id": comment.id,
                            "document_id": document.id,
                            "assignment_id": assignment_id,
                        },
                        within_minutes=5,
                    )
                except Exception as e:
                    logger.error(f"Failed to notify user {user_id} about mention: {e}")

        if mention_warnings:
            logger.warning(
                f"Mention warnings for review comment {comment.id}: {mention_warnings}"
            )

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="DOCUMENT_REVIEWED",
        assignment_id=assignment_id,
        payload={
            "document_id": document.id,
            "review_status": document.review_status.value,
            "comment_created": comment_created,
        },
    )

    db.commit()
    db.refresh(document)

    return DocumentReviewResponse(
        document=DocumentRead.model_validate(document),
        comment_created=comment_created,
        comment_id=comment_id,
    )
