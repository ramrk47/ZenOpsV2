from __future__ import annotations

from datetime import datetime
from typing import Optional

from app.schemas.base import ORMModel


class ActivityRead(ORMModel):
    id: int
    assignment_id: Optional[int] = None
    actor_user_id: Optional[int] = None
    type: str
    message: Optional[str] = None
    payload_json: Optional[dict] = None
    created_at: datetime
    updated_at: datetime
