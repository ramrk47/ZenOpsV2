from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import Field

from app.schemas.base import ORMModel


class DocumentRead(ORMModel):
    id: int
    assignment_id: int
    uploaded_by_user_id: int
    original_name: str
    storage_path: str
    mime_type: Optional[str] = None
    size: int
    category: Optional[str] = None
    version_number: int
    is_final: bool
    created_at: datetime
    updated_at: datetime
    # Review fields
    review_status: str
    visibility: str
    reviewed_by_user_id: Optional[int] = None
    reviewed_at: Optional[datetime] = None
    # Aggregated comment metadata (populated by endpoint)
    comments_count: Optional[int] = None
    unresolved_count: Optional[int] = None
    last_commented_at: Optional[datetime] = None


class DocumentChecklist(ORMModel):
    required_categories: List[str]
    present_categories: List[str]
    missing_categories: List[str]


class MarkFinalPayload(ORMModel):
    is_final: bool = Field(default=True)


class DocumentReviewPayload(ORMModel):
    review_status: str  # REVIEWED, NEEDS_CLARIFICATION, REJECTED, FINAL
    note: Optional[str] = None
    lane: str = "INTERNAL"
    is_visible_to_client: bool = False


class DocumentReviewResponse(ORMModel):
    document: DocumentRead
    comment_created: bool = False
    comment_id: Optional[int] = None
