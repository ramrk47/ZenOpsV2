from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import Field

from app.models.enums import ApprovalActionType, ApprovalEntityType, ApprovalStatus
from app.schemas.base import ORMModel


class ApprovalRequest(ORMModel):
    entity_type: ApprovalEntityType
    entity_id: int
    action_type: ApprovalActionType
    reason: Optional[str] = None
    payload_json: Optional[dict] = None
    approver_user_id: Optional[int] = None
    assignment_id: Optional[int] = None


class ApprovalRead(ORMModel):
    id: int
    entity_type: ApprovalEntityType
    entity_id: int
    action_type: ApprovalActionType
    requester_user_id: int
    approver_user_id: Optional[int] = None
    status: ApprovalStatus
    reason: Optional[str] = None
    payload_json: Optional[dict] = None
    assignment_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    decided_at: Optional[datetime] = None


class ApprovalDecisionPayload(ORMModel):
    comment: Optional[str] = Field(default=None, max_length=1000)


class ApprovalTemplate(ORMModel):
    key: str
    label: str
    description: str
    entity_type: ApprovalEntityType
    action_type: ApprovalActionType
