"""
Notification schemas.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel

from ..models.notification import NotificationType


class NotificationRead(BaseModel):
    id: int
    user_id: int
    type: NotificationType
    message: str
    read_at: Optional[datetime]
    payload_json: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True