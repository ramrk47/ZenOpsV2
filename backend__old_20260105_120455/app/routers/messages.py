"""
Message routes.

Allows users to send and view chat messages on assignments.  Pinned
messages float to the top of the chat view.  Messages are visible to
assignment creators and assignees.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..dependencies import get_db, get_current_active_user
from ..models.assignment import Assignment
from ..models.message import AssignmentMessage
from ..models.user import User
from ..utils import rbac
from ..schemas.message import MessageCreate, MessageRead

router = APIRouter(prefix="/api/assignments/{assignment_id}/messages", tags=["messages"])


def _get_assignment(db: Session, assignment_id: int) -> Assignment:
    assignment = db.get(Assignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return assignment


@router.get("/", response_model=list[MessageRead])
def list_messages(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    assignment = _get_assignment(db, assignment_id)
    # allow if user can read assignment
    if not rbac.user_has_capability(current_user, "assignments.read") and not (
        assignment.created_by_user_id == current_user.id or assignment.assigned_to_user_id == current_user.id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to view messages")
    return [MessageRead.from_orm(m) for m in assignment.messages]


@router.post("/", response_model=MessageRead, status_code=status.HTTP_201_CREATED)
def create_message(
    assignment_id: int,
    message_in: MessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    assignment = _get_assignment(db, assignment_id)
    if not rbac.user_has_capability(current_user, "messages.manage") and not (
        assignment.created_by_user_id == current_user.id or assignment.assigned_to_user_id == current_user.id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to send messages")
    message = AssignmentMessage(
        assignment_id=assignment.id,
        sender_user_id=current_user.id,
        message=message_in.message,
        pinned=message_in.pinned,
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    return MessageRead.from_orm(message)


@router.patch("/{message_id}/pin", response_model=MessageRead)
def toggle_pin(
    assignment_id: int,
    message_id: int,
    pin: bool,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    assignment = _get_assignment(db, assignment_id)
    message = db.get(AssignmentMessage, message_id)
    if not message or message.assignment_id != assignment.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    if not rbac.user_has_capability(current_user, "messages.manage") and message.sender_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to pin/unpin message")
    message.pinned = pin
    db.commit()
    db.refresh(message)
    return MessageRead.from_orm(message)