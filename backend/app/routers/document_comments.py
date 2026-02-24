"""API routes for document comments."""
from datetime import datetime
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.document_comment import CommentLane, DocumentComment
from app.models.enums import NotificationType
from app.models.user import User
from app.schemas.document_comment import (
    DocumentCommentAuthorOut,
    DocumentCommentCreate,
    DocumentCommentListResponse,
    DocumentCommentOut,
    DocumentCommentUpdate,
    ResolveCommentRequest,
)
from app.services.notifications import create_notification_if_absent
from app.utils.mentions import parse_and_resolve_mentions

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/document-comments", tags=["document-comments"])


def _comment_to_out(comment: DocumentComment, reply_count: int = 0) -> DocumentCommentOut:
    """Convert DocumentComment model to output schema."""
    author_out = DocumentCommentAuthorOut(
        id=comment.author.id,
        full_name=comment.author.full_name,
        email=comment.author.email,
    )

    return DocumentCommentOut(
        id=comment.id,
        document_id=comment.document_id,
        assignment_id=comment.assignment_id,
        author_id=comment.author_id,
        author=author_out,
        content=comment.content,
        lane=comment.lane,
        parent_comment_id=comment.parent_comment_id,
        thread_depth=comment.thread_depth,
        mentioned_user_ids=comment.mentioned_users,
        is_resolved=comment.is_resolved,
        resolved_at=comment.resolved_at,
        resolved_by_id=comment.resolved_by_id,
        is_visible_to_client=comment.is_visible_to_client,
        is_edited=comment.is_edited,
        edited_at=comment.edited_at,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
        reply_count=reply_count,
    )


@router.get("/", response_model=DocumentCommentListResponse)
def list_document_comments(
    document_id: int = Query(..., description="Document ID to fetch comments for"),
    lane: Optional[CommentLane] = Query(None, description="Filter by comment lane"),
    include_resolved: bool = Query(True, description="Include resolved comments"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List comments for a document."""
    # Build query
    query = (
        select(DocumentComment)
        .where(DocumentComment.document_id == document_id)
        .options(joinedload(DocumentComment.author))
        .order_by(DocumentComment.created_at.asc())
    )

    # Filter by lane
    if lane:
        query = query.where(DocumentComment.lane == lane)

    # Filter resolved
    if not include_resolved:
        query = query.where(DocumentComment.is_resolved == False)

    # Execute query (sync session)
    result = db.execute(query)
    comments = result.scalars().unique().all()

    # Count replies for each comment
    reply_counts_query = (
        select(
            DocumentComment.parent_comment_id,
            func.count(DocumentComment.id).label('count')
        )
        .where(
            and_(
                DocumentComment.document_id == document_id,
                DocumentComment.parent_comment_id.isnot(None)
            )
        )
        .group_by(DocumentComment.parent_comment_id)
    )
    reply_counts_result = db.execute(reply_counts_query)
    reply_counts = {row[0]: row[1] for row in reply_counts_result.all()}

    # Convert to output schema
    comments_out = [
        _comment_to_out(comment, reply_counts.get(comment.id, 0))
        for comment in comments
    ]

    return DocumentCommentListResponse(
        comments=comments_out,
        total=len(comments_out),
        document_id=document_id,
    )


@router.post("/", response_model=DocumentCommentOut, status_code=status.HTTP_201_CREATED)
def create_document_comment(
    comment_in: DocumentCommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new document comment with @mention parsing."""
    # Calculate thread depth
    thread_depth = 0
    if comment_in.parent_comment_id:
        # Get parent comment to determine depth
        parent_result = db.execute(
            select(DocumentComment).where(DocumentComment.id == comment_in.parent_comment_id)
        )
        parent_comment = parent_result.scalar_one_or_none()
        if not parent_comment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Parent comment not found"
            )
        thread_depth = parent_comment.thread_depth + 1

    # Parse @mentions from content
    mentioned_user_ids, mention_warnings = parse_and_resolve_mentions(
        db, comment_in.content, current_user.id
    )

    # Create comment
    comment = DocumentComment(
        document_id=comment_in.document_id,
        assignment_id=comment_in.assignment_id,
        author_id=current_user.id,
        content=comment_in.content,
        lane=comment_in.lane,
        parent_comment_id=comment_in.parent_comment_id,
        thread_depth=thread_depth,
        is_visible_to_client=comment_in.is_visible_to_client,
    )
    comment.mentioned_users = mentioned_user_ids

    db.add(comment)
    db.commit()
    db.refresh(comment)

    # Send notifications to mentioned users (best-effort)
    if mentioned_user_ids:
        logger.info(
            f"Mentioned users in comment {comment.id}: {mentioned_user_ids} "
            f"(author: {current_user.id}, assignment: {comment_in.assignment_id})"
        )
        for user_id in mentioned_user_ids:
            try:
                create_notification_if_absent(
                    db,
                    user_id=user_id,
                    notif_type=NotificationType.MENTION,
                    message=f"{current_user.full_name or current_user.email} mentioned you in a comment",
                    payload={
                        "comment_id": comment.id,
                        "document_id": comment.document_id,
                        "assignment_id": comment.assignment_id,
                    },
                    within_minutes=5,
                )
            except Exception as e:
                logger.error(f"Failed to notify user {user_id} about mention: {e}")

    # Log warnings if any
    if mention_warnings:
        logger.warning(
            f"Mention warnings for comment {comment.id}: {mention_warnings}"
        )

    return _comment_to_out(comment)


@router.patch("/{comment_id}", response_model=DocumentCommentOut)
def update_document_comment(
    comment_id: int,
    comment_update: DocumentCommentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a document comment (content or resolution status)."""
    # Get comment
    result = db.execute(
        select(DocumentComment)
        .where(DocumentComment.id == comment_id)
        .options(joinedload(DocumentComment.author))
    )
    comment = result.scalar_one_or_none()

    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comment not found"
        )

    # Check permissions (only author can edit content)
    if comment_update.content and comment.author_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the comment author can edit content"
        )

    # Update content and re-parse mentions
    if comment_update.content:
        comment.content = comment_update.content
        comment.is_edited = True
        comment.edited_at = datetime.utcnow()

        # Re-parse mentions
        mentioned_user_ids, mention_warnings = parse_and_resolve_mentions(
            db, comment_update.content, current_user.id
        )
        comment.mentioned_users = mentioned_user_ids

        # Send notifications to newly mentioned users
        if mentioned_user_ids:
            logger.info(
                f"Updated mentions in comment {comment.id}: {mentioned_user_ids}"
            )
            for user_id in mentioned_user_ids:
                try:
                    create_notification_if_absent(
                        db,
                        user_id=user_id,
                        notif_type=NotificationType.MENTION,
                        message=f"{current_user.full_name or current_user.email} mentioned you in a comment",
                        payload={
                            "comment_id": comment.id,
                            "document_id": comment.document_id,
                            "assignment_id": comment.assignment_id,
                        },
                        within_minutes=5,
                    )
                except Exception as e:
                    logger.error(f"Failed to notify user {user_id} about mention: {e}")

        if mention_warnings:
            logger.warning(
                f"Mention warnings for comment {comment.id}: {mention_warnings}"
            )

    # Update resolution status (any user can resolve)
    if comment_update.is_resolved is not None:
        comment.is_resolved = comment_update.is_resolved
        if comment_update.is_resolved:
            comment.resolved_at = datetime.utcnow()
            comment.resolved_by_id = current_user.id
        else:
            comment.resolved_at = None
            comment.resolved_by_id = None

    db.commit()
    db.refresh(comment)

    return _comment_to_out(comment)


@router.delete("/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a document comment."""
    # Get comment
    result = db.execute(
        select(DocumentComment).where(DocumentComment.id == comment_id)
    )
    comment = result.scalar_one_or_none()

    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comment not found"
        )

    # Check permissions (only author can delete)
    if comment.author_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the comment author can delete it"
        )

    # Delete comment (replies will be cascaded based on DB config)
    db.delete(comment)
    db.commit()

    return None


@router.post("/{comment_id}/resolve", response_model=DocumentCommentOut)
def resolve_comment(
    comment_id: int,
    resolve_req: ResolveCommentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Resolve or unresolve a comment."""
    # Get comment
    result = db.execute(
        select(DocumentComment)
        .where(DocumentComment.id == comment_id)
        .options(joinedload(DocumentComment.author))
    )
    comment = result.scalar_one_or_none()

    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comment not found"
        )

    # Update resolution status
    comment.is_resolved = resolve_req.is_resolved
    if resolve_req.is_resolved:
        comment.resolved_at = datetime.utcnow()
        comment.resolved_by_id = current_user.id
    else:
        comment.resolved_at = None
        comment.resolved_by_id = None

    db.commit()
    db.refresh(comment)

    return _comment_to_out(comment)
