from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

import logging

from app.core import rbac
from app.core.settings import settings

logger = logging.getLogger("notifications")
from app.models.enums import (
    NotificationChannel,
    NotificationDeliveryStatus,
    NotificationType,
    Role,
)
from app.models.notification import Notification
from app.models.notification_delivery import NotificationDelivery
from app.models.notification_pref import UserNotificationPreference
from app.models.user import User

PARTNER_EMAIL_TYPES = {
    NotificationType.PARTNER_DOC_REQUESTED,
    NotificationType.PARTNER_REQUEST_NEEDS_INFO,
    NotificationType.PARTNER_REQUEST_APPROVED,
    NotificationType.PARTNER_REQUEST_REJECTED,
    NotificationType.PARTNER_PAYMENT_REQUESTED,
    NotificationType.PARTNER_PAYMENT_VERIFIED,
    NotificationType.PARTNER_DELIVERABLE_RELEASED,
}

INTERNAL_EMAIL_TYPES = {
    NotificationType.APPROVAL_PENDING,
    NotificationType.SLA_OVERDUE,
    NotificationType.TASK_OVERDUE,
    NotificationType.PAYMENT_PENDING,
}


def enqueue_notification_deliveries(
    db: Session,
    *,
    notification: Notification,
    user: User,
) -> None:
    now = datetime.now(timezone.utc)
    in_app = NotificationDelivery(
        notification_id=notification.id,
        user_id=user.id,
        channel=NotificationChannel.IN_APP,
        status=NotificationDeliveryStatus.SENT,
        sent_at=now,
    )
    db.add(in_app)

    if not _should_send_email(db, user, notification.type):
        return
    if not user.email:
        return

    entity_key = _resolve_entity_key(notification.payload_json)
    if _email_recently_queued(
        db,
        user_id=user.id,
        notif_type=notification.type,
        entity_key=entity_key,
        within_minutes=settings.email_dedupe_minutes,
    ):
        return

    delivery = NotificationDelivery(
        notification_id=notification.id,
        user_id=user.id,
        channel=NotificationChannel.EMAIL,
        status=NotificationDeliveryStatus.PENDING,
        to_address=user.email,
        entity_key=entity_key,
    )
    db.add(delivery)

    # WhatsApp stub — log but don't actually send
    if getattr(user, "whatsapp_opted_in", False) and getattr(user, "whatsapp_number", None):
        logger.info(
            "WhatsApp stub: would send to %s (user %s) — %s",
            user.whatsapp_number,
            user.id,
            notification.type,
        )
        wa_delivery = NotificationDelivery(
            notification_id=notification.id,
            user_id=user.id,
            channel=NotificationChannel.WHATSAPP,
            status=NotificationDeliveryStatus.SENT,  # stub — mark as sent
            sent_at=now,
            to_address=user.whatsapp_number,
        )
        db.add(wa_delivery)


def _resolve_entity_key(payload: Optional[dict]) -> Optional[str]:
    if not payload:
        return None
    for key in (
        "commission_request_id",
        "assignment_id",
        "invoice_id",
        "partner_request_id",
        "deliverable_id",
        "approval_id",
    ):
        if payload.get(key) is not None:
            return f"{key}:{payload.get(key)}"
    return None


def _should_send_email(db: Session, user: User, notif_type: NotificationType) -> bool:
    if rbac.user_has_role(user, Role.EXTERNAL_PARTNER):
        return notif_type in PARTNER_EMAIL_TYPES

    preference = db.get(UserNotificationPreference, user.id)
    if preference and not preference.email_enabled:
        return False

    return notif_type in INTERNAL_EMAIL_TYPES


def _email_recently_queued(
    db: Session,
    *,
    user_id: int,
    notif_type: NotificationType,
    entity_key: Optional[str],
    within_minutes: int,
) -> bool:
    if within_minutes <= 0:
        return False
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=within_minutes)
    query = (
        db.query(NotificationDelivery)
        .join(Notification, NotificationDelivery.notification_id == Notification.id)
        .filter(
            NotificationDelivery.user_id == user_id,
            NotificationDelivery.channel == NotificationChannel.EMAIL,
            Notification.type == notif_type,
            NotificationDelivery.created_at >= cutoff,
        )
    )
    if entity_key:
        query = query.filter(NotificationDelivery.entity_key == entity_key)
    return db.query(query.exists()).scalar() is True


def count_emails_sent_today(db: Session, *, user_id: int) -> int:
    now = datetime.now(timezone.utc)
    start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    return (
        db.query(func.count(NotificationDelivery.id))
        .filter(
            NotificationDelivery.user_id == user_id,
            NotificationDelivery.channel == NotificationChannel.EMAIL,
            NotificationDelivery.status == NotificationDeliveryStatus.SENT,
            NotificationDelivery.sent_at >= start,
        )
        .scalar()
        or 0
    )


def get_due_email_deliveries(
    db: Session,
    *,
    limit: int = 50,
) -> list[NotificationDelivery]:
    retry_cutoff = datetime.now(timezone.utc) - timedelta(minutes=settings.email_retry_minutes)
    query = (
        db.query(NotificationDelivery)
        .filter(
            NotificationDelivery.channel == NotificationChannel.EMAIL,
            NotificationDelivery.attempts < settings.email_max_attempts,
            NotificationDelivery.status.in_(
                [NotificationDeliveryStatus.PENDING, NotificationDeliveryStatus.FAILED]
            ),
            (NotificationDelivery.last_attempt_at.is_(None)) | (NotificationDelivery.last_attempt_at <= retry_cutoff),
        )
        .order_by(NotificationDelivery.created_at.asc())
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    return query.all()
