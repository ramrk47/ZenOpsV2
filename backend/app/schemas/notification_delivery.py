from __future__ import annotations

from datetime import datetime
from typing import Optional

from app.models.enums import NotificationChannel, NotificationDeliveryStatus, NotificationType
from app.schemas.base import ORMModel


class NotificationDeliveryRead(ORMModel):
    id: int
    notification_id: int
    user_id: int
    channel: NotificationChannel
    status: NotificationDeliveryStatus
    to_address: Optional[str] = None
    entity_key: Optional[str] = None
    provider_message_id: Optional[str] = None
    error: Optional[str] = None
    attempts: int
    last_attempt_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    notification_type: Optional[NotificationType] = None
    notification_message: Optional[str] = None
    user_email: Optional[str] = None
