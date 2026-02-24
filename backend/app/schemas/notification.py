from __future__ import annotations

from datetime import datetime
from typing import Optional

from app.models.enums import NotificationType
from app.schemas.base import ORMModel


class NotificationRead(ORMModel):
    id: int
    user_id: int
    type: NotificationType
    message: str
    read_at: Optional[datetime] = None
    snoozed_until: Optional[datetime] = None
    payload_json: Optional[dict] = None
    created_at: datetime
    updated_at: datetime


class NotificationMarkRead(ORMModel):
    read: bool = True


class NotificationSnoozeRequest(ORMModel):
    notification_ids: list[int]
    snooze_minutes: Optional[int] = None
    snooze_until: Optional[datetime] = None
    clear: bool = False
