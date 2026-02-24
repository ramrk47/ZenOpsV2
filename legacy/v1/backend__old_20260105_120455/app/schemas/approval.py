"""
Approval schemas.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel

from ..models.approval import ApprovalStatus


class ApprovalCreate(BaseModel):
    entity_type: str
    entity_id: int
    action_type: str
    reason: Optional[str] = None
    payload_json: Optional[str] = None

    class Config:
        from_attributes = True


class ApprovalRead(BaseModel):
    id: int
    entity_type: str
    entity_id: int
    action_type: str
    requester_user_id: Optional[int]
    approver_user_id: Optional[int]
    status: ApprovalStatus
    reason: Optional[str]
    payload_json: Optional[str]
    created_at: datetime
    decided_at: Optional[datetime]

    class Config:
        from_attributes = True