from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import Field

from app.schemas.base import ORMModel


class MobileQueueItem(ORMModel):
    id: int
    assignment_code: str
    bank_or_client: Optional[str] = None
    borrower_name: Optional[str] = None
    status: str
    due_time: Optional[datetime] = None
    due_state: str
    updated_at: datetime
    next_action: str
    badges: List[str] = Field(default_factory=list)


class MobileSummaryResponse(ORMModel):
    unread_notifications: int
    approvals_pending: int
    overdue_assignments: int
    payments_pending: int
    my_queue: List[MobileQueueItem] = Field(default_factory=list)
    generated_at: datetime


class MobileTimelineEntry(ORMModel):
    id: str
    created_at: datetime
    event_type: str
    message: str
    actor_label: Optional[str] = None


class MobileDocumentItem(ORMModel):
    id: int
    original_name: str
    category: Optional[str] = None
    mime_type: Optional[str] = None
    size: int
    review_status: str
    visibility: str
    created_at: datetime
    comments_count: int = 0


class MobileCommentItem(ORMModel):
    id: int
    document_id: int
    lane: str
    content: str
    author_label: str
    created_at: datetime
    is_resolved: bool


class MobileAssignmentOverview(ORMModel):
    id: int
    assignment_code: str
    bank_or_client: Optional[str] = None
    borrower_name: Optional[str] = None
    status: str
    due_time: Optional[datetime] = None
    due_state: str
    updated_at: datetime
    next_action: str
    badges: List[str] = Field(default_factory=list)


class MobileAssignmentDetailResponse(ORMModel):
    overview: MobileAssignmentOverview
    timeline: List[MobileTimelineEntry] = Field(default_factory=list)
    documents: List[MobileDocumentItem] = Field(default_factory=list)
    comments: List[MobileCommentItem] = Field(default_factory=list)
    can_upload: bool = True
    can_comment: bool = True
    can_raise_request: bool = True


class MobileCommentCreate(ORMModel):
    document_id: Optional[int] = None
    content: str = Field(..., min_length=1, max_length=5000)
    lane: Optional[str] = Field(default="INTERNAL")
    is_visible_to_client: bool = False


class MobileRaiseRequestCreate(ORMModel):
    subject: Optional[str] = Field(default=None, max_length=300)
    message: str = Field(..., min_length=1, max_length=5000)
    priority: str = Field(default="MEDIUM", max_length=20)


class MobileRaiseRequestResponse(ORMModel):
    kind: str
    id: int
    status: str

