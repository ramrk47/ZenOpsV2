"""
Activity log schemas.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class ActivityRead(BaseModel):
    id: int
    assignment_id: Optional[int]
    actor_user_id: Optional[int]
    type: str
    payload_json: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True