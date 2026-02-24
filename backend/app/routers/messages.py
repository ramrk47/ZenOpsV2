from __future__ import annotations

from datetime import datetime, timezone
import re
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.deps import get_current_user
from app.core.guards import require_destructive_allowed
from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.enums import NotificationType
from app.models.message import AssignmentMessage
from app.models.user import User
from app.schemas.message import MessageCreate, MessageRead, MessageUpdate
from app.services.activity import log_activity
from app.services.assignments import ensure_assignment_access
from app.services.notifications import create_notification

router = APIRouter(prefix="/api/assignments/{assignment_id}/messages", tags=["messages"])

MENTION_PATTERN = re.compile(r"@\[[^\]]+\]\((\d+)\)")


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


def _notify_mentions(db: Session, message: AssignmentMessage) -> None:
    if not message.mentions:
        return
    for user_id in message.mentions:
        if user_id == message.sender_user_id:
            continue
        create_notification(
            db,
            user_id=int(user_id),
            notif_type=NotificationType.MENTION,
            message=f"You were mentioned on {message.assignment.assignment_code}",
            payload={"assignment_id": message.assignment_id, "message_id": message.id},
        )


def _parse_mentions_from_text(text: str) -> set[int]:
    ids: set[int] = set()
    if not text:
        return ids
    for match in MENTION_PATTERN.findall(text):
        try:
            ids.add(int(match))
        except ValueError:
            continue
    return ids


def _validate_mentions(db: Session, mention_ids: set[int]) -> list[int]:
    if not mention_ids:
        return []
    users = db.query(User).filter(User.id.in_(mention_ids), User.is_active.is_(True)).all()
    valid_ids = {user.id for user in users}
    invalid_ids = sorted(mention_ids - valid_ids)
    if invalid_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid mentioned user ids: {invalid_ids}",
        )
    return sorted(valid_ids)


@router.get("", response_model=List[MessageRead])
def list_messages(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[MessageRead]:
    assignment = _get_assignment_or_404(db, assignment_id)
    _require_access(assignment, current_user)
    messages = db.query(AssignmentMessage).filter(AssignmentMessage.assignment_id == assignment_id).order_by(AssignmentMessage.created_at.asc()).all()
    return [MessageRead.model_validate(m) for m in messages]


@router.post("", response_model=MessageRead, status_code=status.HTTP_201_CREATED)
def create_message(
    assignment_id: int,
    message_in: MessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MessageRead:
    assignment = _get_assignment_or_404(db, assignment_id)
    _require_access(assignment, current_user)

    mention_ids = set(message_in.mentions or [])
    mention_ids.update(_parse_mentions_from_text(message_in.message))
    validated_mentions = _validate_mentions(db, mention_ids)

    message = AssignmentMessage(
        assignment_id=assignment_id,
        sender_user_id=current_user.id,
        message=message_in.message,
        mentions=validated_mentions,
        pinned=message_in.pinned,
        updated_at=datetime.now(timezone.utc),
    )
    db.add(message)
    db.flush()

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="MESSAGE_CREATED",
        assignment_id=assignment_id,
        payload={"message_id": message.id},
    )

    _notify_mentions(db, message)

    db.commit()
    db.refresh(message)
    return MessageRead.model_validate(message)


@router.patch("/{message_id}", response_model=MessageRead)
def update_message(
    assignment_id: int,
    message_id: int,
    message_update: MessageUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MessageRead:
    assignment = _get_assignment_or_404(db, assignment_id)
    _require_access(assignment, current_user)

    message = db.get(AssignmentMessage, message_id)
    if not message or message.assignment_id != assignment_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    capabilities = rbac.get_capabilities_for_user(current_user)
    if message.sender_user_id != current_user.id and not capabilities.get("view_all_assignments"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted to edit this message")

    update_data = message_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(message, field, value)
    message.updated_at = datetime.now(timezone.utc)
    db.add(message)

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="MESSAGE_UPDATED",
        assignment_id=assignment_id,
        payload={"message_id": message.id},
    )

    db.commit()
    db.refresh(message)
    return MessageRead.model_validate(message)


@router.post("/{message_id}/pin", response_model=MessageRead)
def pin_message(
    assignment_id: int,
    message_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MessageRead:
    return _set_pinned(assignment_id, message_id, True, db, current_user)


@router.post("/{message_id}/unpin", response_model=MessageRead)
def unpin_message(
    assignment_id: int,
    message_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MessageRead:
    return _set_pinned(assignment_id, message_id, False, db, current_user)


def _set_pinned(assignment_id: int, message_id: int, pinned: bool, db: Session, current_user: User) -> MessageRead:
    assignment = _get_assignment_or_404(db, assignment_id)
    _require_access(assignment, current_user)

    message = db.get(AssignmentMessage, message_id)
    if not message or message.assignment_id != assignment_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    capabilities = rbac.get_capabilities_for_user(current_user)
    if message.sender_user_id != current_user.id and not capabilities.get("view_all_assignments"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted to pin this message")

    message.pinned = pinned
    message.updated_at = datetime.now(timezone.utc)
    db.add(message)
    db.commit()
    db.refresh(message)
    return MessageRead.model_validate(message)


@router.delete("/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_message(
    assignment_id: int,
    message_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    require_destructive_allowed("delete_message")
    assignment = _get_assignment_or_404(db, assignment_id)
    _require_access(assignment, current_user)

    message = db.get(AssignmentMessage, message_id)
    if not message or message.assignment_id != assignment_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    capabilities = rbac.get_capabilities_for_user(current_user)
    if message.sender_user_id != current_user.id and not capabilities.get("view_all_assignments"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted to delete this message")

    db.delete(message)
    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="MESSAGE_DELETED",
        assignment_id=assignment_id,
        payload={"message_id": message_id},
    )
    db.commit()
    return None
