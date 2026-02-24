from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import Field
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.enums import NotificationChannel, NotificationDeliveryStatus, NotificationType, Role
from app.models.notification import Notification
from app.models.notification_delivery import NotificationDelivery
from app.models.user import User
from app.schemas.base import ORMModel
from app.schemas.notification import NotificationRead, NotificationSnoozeRequest
from app.schemas.notification_delivery import NotificationDeliveryRead
from app.services.notification_sweep import run_notification_sweep

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("", response_model=List[NotificationRead])
def list_notifications(
    unread_only: bool = Query(False),
    include_snoozed: bool = Query(False),
    notif_type: Optional[NotificationType] = Query(None, alias="type"),
    search: Optional[str] = Query(None, max_length=120),
    created_from: Optional[datetime] = Query(None),
    created_to: Optional[datetime] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[NotificationRead]:
    if created_from and created_to and created_from > created_to:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="created_from must be before created_to")
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
    if created_from:
        query = query.filter(Notification.created_at >= created_from)
    if created_to:
        query = query.filter(Notification.created_at <= created_to)
    notifications = query.order_by(Notification.created_at.desc()).limit(limit).all()
    return [NotificationRead.model_validate(n) for n in notifications]


@router.get("/unread-count", response_model=dict)
def unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
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


@router.post("/{notification_id}/read", response_model=NotificationRead)
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> NotificationRead:
    notification = db.get(Notification, notification_id)
    if not notification or notification.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    notification.read_at = datetime.now(timezone.utc)
    db.add(notification)
    db.commit()
    db.refresh(notification)
    return NotificationRead.model_validate(notification)


@router.post("/read-all", response_model=dict)
def mark_all_read(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
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


@router.post("/snooze", response_model=dict)
def snooze_notifications(
    payload: NotificationSnoozeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if not payload.notification_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="notification_ids required")
    query = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.id.in_(payload.notification_ids))
        .all()
    )
    if not query:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notifications not found")

    now = datetime.now(timezone.utc)
    if payload.clear:
        for notification in query:
            notification.snoozed_until = None
            db.add(notification)
        db.commit()
        return {"updated": len(query), "snoozed_until": None}

    if payload.snooze_until:
        until = payload.snooze_until
        if until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
    else:
        minutes = payload.snooze_minutes or 60
        if minutes <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="snooze_minutes must be positive")
        until = now + timedelta(minutes=minutes)

    if until <= now:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="snooze_until must be in the future")

    for notification in query:
        notification.snoozed_until = until
        db.add(notification)
    db.commit()
    return {"updated": len(query), "snoozed_until": until}


@router.post("/sweep", response_model=dict)
def sweep_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if not rbac.user_has_any_role(current_user, {Role.ADMIN, Role.OPS_MANAGER}) and not rbac.can_view_all(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to sweep notifications")
    result = run_notification_sweep(db)
    db.commit()
    return result


@router.get("/deliveries", response_model=List[NotificationDeliveryRead])
def list_notification_deliveries(
    channel: Optional[NotificationChannel] = Query(None),
    status_filter: Optional[NotificationDeliveryStatus] = Query(None, alias="status"),
    user_id: Optional[int] = Query(None),
    notif_type: Optional[NotificationType] = Query(None, alias="type"),
    created_from: Optional[datetime] = Query(None),
    created_to: Optional[datetime] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[NotificationDeliveryRead]:
    if not rbac.user_has_any_role(current_user, {Role.ADMIN, Role.OPS_MANAGER}) and not rbac.can_view_all(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to view deliveries")
    query = db.query(NotificationDelivery)
    if channel:
        query = query.filter(NotificationDelivery.channel == channel)
    if status_filter:
        query = query.filter(NotificationDelivery.status == status_filter)
    if user_id:
        query = query.filter(NotificationDelivery.user_id == user_id)
    if notif_type:
        query = query.join(Notification, NotificationDelivery.notification_id == Notification.id).filter(Notification.type == notif_type)
    if created_from:
        query = query.filter(NotificationDelivery.created_at >= created_from)
    if created_to:
        query = query.filter(NotificationDelivery.created_at <= created_to)
    rows = query.order_by(NotificationDelivery.created_at.desc()).limit(limit).all()
    return [NotificationDeliveryRead.model_validate(row) for row in rows]


# ---------------------------------------------------------------------------
# WhatsApp opt-in / opt-out
# ---------------------------------------------------------------------------


class WhatsAppOptInRequest(ORMModel):
    whatsapp_number: str = Field(..., min_length=7, max_length=20)


@router.post("/whatsapp/opt-in", response_model=dict)
def whatsapp_opt_in(
    body: WhatsAppOptInRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    current_user.whatsapp_opted_in = True
    current_user.whatsapp_number = body.whatsapp_number.strip()
    current_user.whatsapp_consent_at = datetime.now(timezone.utc)
    db.add(current_user)
    db.commit()
    return {"status": "opted_in", "whatsapp_number": current_user.whatsapp_number}


@router.post("/whatsapp/opt-out", response_model=dict)
def whatsapp_opt_out(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    current_user.whatsapp_opted_in = False
    current_user.whatsapp_number = None
    current_user.whatsapp_consent_at = None
    db.add(current_user)
    db.commit()
    return {"status": "opted_out"}
