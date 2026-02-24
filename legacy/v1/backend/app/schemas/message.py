from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import Field

from app.schemas.base import ORMModel


class MessageBase(ORMModel):
    message: str = Field(..., min_length=1)
    mentions: Optional[List[int]] = None
    pinned: bool = False


class MessageCreate(MessageBase):
    pass


class MessageUpdate(ORMModel):
    message: Optional[str] = Field(default=None, min_length=1)
    mentions: Optional[List[int]] = None
    pinned: Optional[bool] = None


class MessageRead(MessageBase):
    id: int
    assignment_id: int
    sender_user_id: int
    created_at: datetime
    updated_at: datetime
