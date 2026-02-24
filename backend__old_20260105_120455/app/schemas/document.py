"""
Document schemas.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class DocumentRead(BaseModel):
    id: int
    assignment_id: int
    original_name: str
    category: Optional[str] = None
    version_number: Optional[int] = None
    is_final: bool
    mime_type: Optional[str] = None
    size: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True