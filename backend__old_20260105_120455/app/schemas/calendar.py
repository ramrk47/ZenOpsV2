"""
Calendar schemas.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel

from ..models.calendar import EventType


class CalendarEventCreate(BaseModel):
    event_type: EventType
    title: str
    start_at: datetime
    end_at: datetime
    assignment_id: Optional[int] = None
    assigned_to_user_id: Optional[int] = None

    class Config:
        from_attributes = True


class CalendarEventRead(BaseModel):
    id: int
    event_type: EventType
    title: str
    start_at: datetime
    end_at: datetime
    assignment_id: Optional[int]
    created_by_user_id: Optional[int]
    assigned_to_user_id: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True