from __future__ import annotations

from typing import Iterable, Optional, Sequence

from sqlalchemy.orm import Session

from app.models.enums import NotificationType, Role
from app.models.notification import Notification
from app.models.user import User
from app.services.notifications import create_notification


def get_partner_users(db: Session, partner_id: int) -> list[User]:
    return (
        db.query(User)
        .filter(
            User.partner_id == partner_id,
            User.has_role(Role.EXTERNAL_PARTNER),
            User.is_active.is_(True),
        )
        .all()
    )


def notify_partner_users(
    db: Session,
    *,
    partner_id: int,
    notif_type: NotificationType,
    message: str,
    payload: Optional[dict] = None,
    exclude_user_ids: Optional[Iterable[int]] = None,
) -> list[Notification]:
    exclude_set = set(exclude_user_ids or [])
    created: list[Notification] = []
    for user in get_partner_users(db, partner_id):
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
