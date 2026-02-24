"""
Message schemas.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class MessageBase(BaseModel):
    message: str
    pinned: bool = False

    class Config:
        from_attributes = True


class MessageCreate(MessageBase):
    pass


class MessageRead(MessageBase):
    id: int
    assignment_id: int
    sender_user_id: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True