from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional, Sequence

from sqlalchemy.orm import Session

from app.models.enums import NotificationType, Role
from app.models.notification import Notification
from app.models.user import User
from app.services.notification_deliveries import enqueue_notification_deliveries


def create_notification(
    db: Session,
    *,
    user_id: int,
    notif_type: NotificationType,
    message: str,
    payload: Optional[dict] = None,
    user: Optional[User] = None,
) -> Notification:
    notification = Notification(
        user_id=user_id,
        type=notif_type,
        message=message,
        payload_json=payload,
    )
    db.add(notification)
    db.flush()
    resolved_user = user or db.get(User, user_id)
    if resolved_user:
        enqueue_notification_deliveries(db, notification=notification, user=resolved_user)
    return notification


def _payload_matches(payload: Optional[dict], match: Optional[dict]) -> bool:
    if not match:
        return True
    if not payload:
        return False
    for key, value in match.items():
        if payload.get(key) != value:
            return False
    return True


def was_recently_notified(
    db: Session,
    *,
    user_id: int,
    notif_type: NotificationType,
    payload_match: Optional[dict] = None,
    within_minutes: int = 60,
) -> bool:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=within_minutes)
    recent = (
        db.query(Notification)
        .filter(
            Notification.user_id == user_id,
            Notification.type == notif_type,
            Notification.created_at >= cutoff,
        )
        .order_by(Notification.created_at.desc())
        .limit(50)
        .all()
    )
    return any(_payload_matches(n.payload_json, payload_match) for n in recent)


def create_notification_if_absent(
    db: Session,
    *,
    user_id: int,
    notif_type: NotificationType,
    message: str,
    payload: Optional[dict] = None,
    payload_match: Optional[dict] = None,
    within_minutes: int = 60,
    user: Optional[User] = None,
) -> Optional[Notification]:
    if was_recently_notified(
        db,
        user_id=user_id,
        notif_type=notif_type,
        payload_match=payload_match or payload,
        within_minutes=within_minutes,
    ):
        return None
    return create_notification(
        db,
        user_id=user_id,
        user=user,
        notif_type=notif_type,
        message=message,
        payload=payload,
    )


def notify_roles(
    db: Session,
    *,
    roles: Sequence[Role],
    notif_type: NotificationType,
    message: str,
    payload: Optional[dict] = None,
    exclude_user_ids: Optional[Iterable[int]] = None,
) -> list[Notification]:
    exclude_set = set(exclude_user_ids or [])
    users = db.query(User).filter(User.has_any_role(roles), User.is_active.is_(True)).all()
    created: list[Notification] = []
    for user in users:
        if user.id in exclude_set:
            continue
        created.append(
            create_notification(
                db,
                user_id=user.id,
                user=user,
                notif_type=notif_type,
                message=message,
                payload=payload,
            )
        )
    return created


def notify_roles_if_absent(
    db: Session,
    *,
    roles: Sequence[Role],
    notif_type: NotificationType,
    message: str,
    payload: Optional[dict] = None,
    payload_match: Optional[dict] = None,
    exclude_user_ids: Optional[Iterable[int]] = None,
    within_minutes: int = 60,
) -> list[Notification]:
    exclude_set = set(exclude_user_ids or [])
    users = db.query(User).filter(User.has_any_role(roles), User.is_active.is_(True)).all()
    created: list[Notification] = []
    for user in users:
        if user.id in exclude_set:
            continue
        notification = create_notification_if_absent(
            db,
            user_id=user.id,
            user=user,
            notif_type=notif_type,
            message=message,
            payload=payload,
            payload_match=payload_match,
            within_minutes=within_minutes,
        )
        if notification:
            created.append(notification)
    return created
