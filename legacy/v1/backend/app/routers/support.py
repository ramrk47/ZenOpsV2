"""Support system API routes (internal and external portal)."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.enums import AuthorType, Role, SupportThreadStatus
from app.models.support import SupportMessage, SupportThread
from app.models.user import User
from app.schemas.support import (
    ExternalSupportMessageCreate,
    ExternalSupportThreadCreate,
    PublicConfigResponse,
    SupportMessageCreate,
    SupportMessageResponse,
    SupportThreadCreate,
    SupportThreadDetail,
    SupportThreadResponse,
    SupportThreadUpdate,
    SupportTokenCreate,
    SupportTokenContext,
    SupportTokenResponse,
    SystemConfigResponse,
    SystemConfigUpdate,
)
from app.services.support_emails import send_support_message_email, send_support_thread_created_email
from app.utils.support_tokens import (
    build_support_portal_url,
    generate_support_token,
    get_token_context,
    revoke_support_token,
    verify_support_token,
)
from app.utils.system_config import (
    get_config,
    get_ops_support_email,
    get_public_configs,
    get_whatsapp_number,
    is_support_bubble_enabled,
    set_config,
)


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/support", tags=["support"])


# ============================================================================
# INTERNAL SUPPORT ROUTES (Admin/Ops)
# ============================================================================

@router.get("/threads", response_model=List[SupportThreadResponse])
def list_support_threads(
    status: Optional[SupportThreadStatus] = Query(None),
    assignment_id: Optional[int] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[SupportThreadResponse]:
    """List support threads (Admin/Ops only)."""
    if not rbac.can_manage_support(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    query = db.query(SupportThread)
    
    if status:
        query = query.filter(SupportThread.status == status)
    if assignment_id:
        query = query.filter(SupportThread.assignment_id == assignment_id)
    
    threads = query.order_by(SupportThread.last_message_at.desc().nullsfirst()).limit(limit).all()
    
    # Add message count
    results = []
    for thread in threads:
        thread_dict = SupportThreadResponse.model_validate(thread).model_dump()
        thread_dict["message_count"] = db.query(SupportMessage).filter(SupportMessage.thread_id == thread.id).count()
        if thread.assignment:
            thread_dict["assignment_code"] = thread.assignment.assignment_code
        results.append(SupportThreadResponse(**thread_dict))
    
    return results


@router.post("/threads", response_model=SupportThreadResponse, status_code=status.HTTP_201_CREATED)
def create_support_thread(
    data: SupportThreadCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SupportThreadResponse:
    """Create a new support thread (internal)."""
    if not rbac.can_manage_support(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    # Validate assignment if provided
    if data.assignment_id:
        assignment = db.query(Assignment).filter(Assignment.id == data.assignment_id).first()
        if not assignment:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    
    # Create thread
    thread = SupportThread(
        subject=data.subject,
        assignment_id=data.assignment_id,
        created_by_user_id=current_user.id,
        created_via=AuthorType.INTERNAL,
        status=SupportThreadStatus.OPEN,
        priority=data.priority,
    )
    db.add(thread)
    db.flush()
    
    # Create initial message
    message = SupportMessage(
        thread_id=thread.id,
        author_user_id=current_user.id,
        author_type=AuthorType.INTERNAL,
        author_label=current_user.full_name or current_user.email,
        message_text=data.initial_message,
    )
    db.add(message)
    
    thread.last_message_at = message.created_at
    db.add(thread)
    
    db.commit()
    db.refresh(thread)
    
    logger.info(f"Support thread created: {thread.id} by user {current_user.id}")
    
    # Send email notification to ops if configured
    ops_email = get_ops_support_email(db)
    if ops_email:
        try:
            send_support_thread_created_email(
                db,
                thread=thread,
                recipient_email=ops_email,
                recipient_name="Ops Team",
            )
            db.commit()
        except Exception as exc:
            logger.error(f"Failed to send thread created email: {exc}")
            db.rollback()
    
    return SupportThreadResponse.model_validate(thread)


@router.get("/threads/{thread_id}", response_model=SupportThreadDetail)
def get_support_thread(
    thread_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SupportThreadDetail:
    """Get support thread details with all messages."""
    if not rbac.can_manage_support(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    thread = db.query(SupportThread).filter(SupportThread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    
    messages = db.query(SupportMessage).filter(
        SupportMessage.thread_id == thread_id
    ).order_by(SupportMessage.created_at.asc()).all()
    
    thread_data = SupportThreadDetail.model_validate(thread).model_dump()
    thread_data["messages"] = [SupportMessageResponse.model_validate(m) for m in messages]
    
    return SupportThreadDetail(**thread_data)


@router.patch("/threads/{thread_id}", response_model=SupportThreadResponse)
def update_support_thread(
    thread_id: int,
    data: SupportThreadUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SupportThreadResponse:
    """Update support thread status/priority."""
    if not rbac.can_manage_support(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    thread = db.query(SupportThread).filter(SupportThread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    
    if data.status:
        thread.status = data.status
        if data.status in {SupportThreadStatus.RESOLVED, SupportThreadStatus.CLOSED}:
            thread.closed_at = datetime.now(timezone.utc)
    
    if data.priority:
        thread.priority = data.priority
    
    thread.updated_at = datetime.now(timezone.utc)
    db.add(thread)
    db.commit()
    db.refresh(thread)
    
    logger.info(f"Support thread {thread_id} updated by user {current_user.id}")
    
    return SupportThreadResponse.model_validate(thread)


@router.post("/threads/{thread_id}/messages", response_model=SupportMessageResponse, status_code=status.HTTP_201_CREATED)
def create_support_message(
    thread_id: int,
    data: SupportMessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SupportMessageResponse:
    """Add a message to a support thread."""
    if not rbac.can_manage_support(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    thread = db.query(SupportThread).filter(SupportThread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    
    message = SupportMessage(
        thread_id=thread_id,
        author_user_id=current_user.id,
        author_type=AuthorType.INTERNAL,
        author_label=current_user.full_name or current_user.email,
        message_text=data.message_text,
        attachments_json=data.attachments_json,
    )
    db.add(message)
    
    thread.last_message_at = datetime.now(timezone.utc)
    db.add(thread)
    
    db.commit()
    db.refresh(message)
    
    logger.info(f"Message added to thread {thread_id} by user {current_user.id}")
    
    return SupportMessageResponse.model_validate(message)


# ============================================================================
# TOKEN MANAGEMENT
# ============================================================================

@router.post("/tokens", response_model=SupportTokenResponse, status_code=status.HTTP_201_CREATED)
def create_support_token(
    data: SupportTokenCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SupportTokenResponse:
    """Generate a support portal token."""
    if not rbac.can_manage_support(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    raw_token, token_record = generate_support_token(
        db,
        assignment_id=data.assignment_id,
        thread_id=data.thread_id,
        created_by_user_id=current_user.id,
        expires_in_days=data.expires_in_days,
    )
    
    db.commit()
    
    logger.info(f"Support token created: {token_record.id} by user {current_user.id}")
    
    return SupportTokenResponse(
        id=token_record.id,
        token=raw_token,
        expires_at=token_record.expires_at,
        assignment_id=token_record.assignment_id,
        thread_id=token_record.thread_id,
    )


@router.delete("/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_token(
    token_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Revoke a support token."""
    if not rbac.can_manage_support(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    success = revoke_support_token(db, token_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token not found")
    
    db.commit()
    logger.info(f"Support token {token_id} revoked by user {current_user.id}")


# ============================================================================
# EXTERNAL PORTAL ROUTES (Token-based access)
# ============================================================================

@router.get("/portal/context", response_model=SupportTokenContext)
def get_portal_context(
    token: str = Query(...),
    db: Session = Depends(get_db),
) -> SupportTokenContext:
    """Get context for a support token (no auth required)."""
    token_record = verify_support_token(db, token)
    if not token_record:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    
    db.commit()  # Save used_count increment
    
    context = get_token_context(db, token_record)
    return SupportTokenContext(**context)


@router.post("/portal/threads", response_model=SupportThreadResponse, status_code=status.HTTP_201_CREATED)
def create_external_support_thread(
    data: ExternalSupportThreadCreate,
    db: Session = Depends(get_db),
) -> SupportThreadResponse:
    """Create support thread from external portal (token-based)."""
    token_record = verify_support_token(db, data.token)
    if not token_record:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    
    # Create thread
    thread = SupportThread(
        subject=data.subject,
        assignment_id=token_record.assignment_id,
        created_by_user_id=token_record.created_by_user_id,  # Token creator
        created_via=AuthorType.EXTERNAL,
        status=SupportThreadStatus.OPEN,
        priority=data.priority,
    )
    db.add(thread)
    db.flush()
    
    # Create initial message
    message = SupportMessage(
        thread_id=thread.id,
        author_user_id=None,  # External author
        author_type=AuthorType.EXTERNAL,
        author_label="External User",
        message_text=data.message,
    )
    db.add(message)
    
    thread.last_message_at = message.created_at
    db.add(thread)
    
    db.commit()
    db.refresh(thread)
    
    logger.info(f"External support thread created: {thread.id}")
    
    # Send notification email
    ops_email = get_ops_support_email(db)
    if ops_email:
        try:
            send_support_thread_created_email(db, thread=thread, recipient_email=ops_email)
            db.commit()
        except Exception as exc:
            logger.error(f"Failed to send external thread notification: {exc}")
    
    return SupportThreadResponse.model_validate(thread)


@router.post("/portal/threads/{thread_id}/messages", response_model=SupportMessageResponse, status_code=status.HTTP_201_CREATED)
def create_external_message(
    thread_id: int,
    data: ExternalSupportMessageCreate,
    db: Session = Depends(get_db),
) -> SupportMessageResponse:
    """Add message from external portal."""
    token_record = verify_support_token(db, data.token)
    if not token_record:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    
    thread = db.query(SupportThread).filter(SupportThread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    
    # Verify token scope
    if token_record.thread_id and token_record.thread_id != thread_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token not valid for this thread")
    if token_record.assignment_id and thread.assignment_id != token_record.assignment_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token not valid for this thread")
    
    message = SupportMessage(
        thread_id=thread_id,
        author_user_id=None,
        author_type=AuthorType.EXTERNAL,
        author_label="External User",
        message_text=data.message,
    )
    db.add(message)
    
    thread.last_message_at = datetime.now(timezone.utc)
    db.add(thread)
    
    db.commit()
    db.refresh(message)
    
    logger.info(f"External message added to thread {thread_id}")
    
    return SupportMessageResponse.model_validate(message)


# ============================================================================
# PUBLIC CONFIGURATION
# ============================================================================

@router.get("/config/public", response_model=PublicConfigResponse)
def get_public_config(db: Session = Depends(get_db)) -> PublicConfigResponse:
    """Get public system configuration (no auth required)."""
    return PublicConfigResponse(
        whatsapp_number=get_whatsapp_number(db),
        support_bubble_enabled=is_support_bubble_enabled(db),
    )


# Alias for frontend compatibility
@router.get("/public/config", response_model=PublicConfigResponse)
def get_public_config_alias(db: Session = Depends(get_db)) -> PublicConfigResponse:
    """Alias: Get public system configuration (no auth required)."""
    return PublicConfigResponse(
        whatsapp_number=get_whatsapp_number(db),
        support_bubble_enabled=is_support_bubble_enabled(db),
    )


@router.get("/config", response_model=dict)
def get_system_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Get editable support-related system configuration."""
    if not rbac.can_manage_support(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    return {
        "WHATSAPP_NUMBER": get_config(db, "WHATSAPP_NUMBER", default="917975357599") or "",
        "OPS_SUPPORT_EMAIL": get_config(db, "OPS_SUPPORT_EMAIL", default="") or "",
        "SUPPORT_BUBBLE_ENABLED": is_support_bubble_enabled(db),
        "SUPPORT_PORTAL_BASE_URL": get_config(db, "SUPPORT_PORTAL_BASE_URL", default="") or "",
    }


@router.put("/config", response_model=dict)
def update_system_config(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Update editable support-related system configuration."""
    if not rbac.can_manage_support(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    allowed_keys = {
        "WHATSAPP_NUMBER": True,
        "OPS_SUPPORT_EMAIL": False,
        "SUPPORT_BUBBLE_ENABLED": True,
        "SUPPORT_PORTAL_BASE_URL": False,
    }
    for key, public in allowed_keys.items():
        if key in payload:
            value = payload[key]
            if isinstance(value, bool):
                value = "true" if value else "false"
            else:
                value = str(value).strip()
            set_config(db, key, value, is_public=public)

    db.commit()
    return {
        "status": "ok",
        "updated": [key for key in allowed_keys if key in payload],
    }


# ============================================================================
# ADDITIONAL THREAD ACTIONS
# ============================================================================

@router.post("/threads/{thread_id}/close", response_model=SupportThreadResponse)
def close_support_thread(
    thread_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Close a support thread."""
    if not rbac.can_manage_support(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    thread = db.query(SupportThread).filter(SupportThread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    
    thread.status = SupportThreadStatus.CLOSED
    thread.closed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(thread)
    return thread


@router.post("/threads/{thread_id}/resolve", response_model=SupportThreadResponse)
def resolve_support_thread(
    thread_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Resolve a support thread."""
    if not rbac.can_manage_support(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    thread = db.query(SupportThread).filter(SupportThread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    
    thread.status = SupportThreadStatus.RESOLVED
    thread.resolved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(thread)
    return thread


@router.post("/tokens/{token_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
def revoke_token_alias(
    token_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Revoke a support token (POST alias for DELETE)."""
    if not rbac.can_manage_support(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    revoked = revoke_support_token(db, token_id)
    if not revoked:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token not found")
    return None


# ============================================================================
# PORTAL ENDPOINTS (External access)
# ============================================================================

@router.get("/portal/{thread_id}", response_model=SupportThreadDetail)
def get_portal_thread(
    thread_id: int,
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    """Get thread details from external portal."""
    context = verify_support_token(db, token)
    if not context:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    
    thread = db.query(SupportThread).filter(SupportThread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    
    # Verify token is for this assignment
    if thread.assignment_id != context.assignment_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token not valid for this thread")
    
    return SupportThreadDetail.model_validate(thread)


@router.get("/portal/{assignment_id}/threads", response_model=List[SupportThreadResponse])
def get_portal_threads(
    assignment_id: int,
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    """Get all threads for an assignment from external portal."""
    context = verify_support_token(db, token)
    if not context:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    
    if context.assignment_id != assignment_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token not valid for this assignment")
    
    threads = db.query(SupportThread).filter(SupportThread.assignment_id == assignment_id).order_by(SupportThread.created_at.desc()).all()
    return [SupportThreadResponse.model_validate(t) for t in threads]


@router.get("/portal/{thread_id}/messages", response_model=List[SupportMessageResponse])
def get_portal_messages(
    thread_id: int,
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    """Get messages for a thread from external portal."""
    context = verify_support_token(db, token)
    if not context:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    
    thread = db.query(SupportThread).filter(SupportThread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    
    if thread.assignment_id != context.assignment_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token not valid for this thread")
    
    messages = db.query(SupportMessage).filter(SupportMessage.thread_id == thread_id).order_by(SupportMessage.created_at.asc()).all()
    return [SupportMessageResponse.model_validate(m) for m in messages]
