"""
Notification routes.

Allows users to view their notifications and mark them as read.
"""

from __future__ import annotations

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..dependencies import get_db, get_current_active_user
from ..models.notification import Notification
from ..models.user import User
from ..schemas.notification import NotificationRead

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("/", response_model=list[NotificationRead])
def list_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    notifications = db.query(Notification).filter(Notification.user_id == current_user.id).all()
    return [NotificationRead.from_orm(n) for n in notifications]


@router.post("/{notification_id}/read", response_model=NotificationRead)
def mark_notification_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    n = db.get(Notification, notification_id)
    if not n or n.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    n.read_at = datetime.utcnow()
    db.commit()
    db.refresh(n)
    return NotificationRead.from_orm(n)