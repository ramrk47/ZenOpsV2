"""Pydantic schemas for document comments."""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from app.models.document_comment import CommentLane


class DocumentCommentBase(BaseModel):
    """Base schema for document comments."""
    content: str = Field(..., min_length=1, max_length=5000)
    lane: CommentLane = CommentLane.INTERNAL
    parent_comment_id: Optional[int] = None
    mentioned_user_ids: List[int] = []
    is_visible_to_client: bool = False


class DocumentCommentCreate(DocumentCommentBase):
    """Schema for creating a document comment."""
    document_id: int
    assignment_id: int


class DocumentCommentUpdate(BaseModel):
    """Schema for updating a document comment."""
    content: Optional[str] = Field(None, min_length=1, max_length=5000)
    is_resolved: Optional[bool] = None


class DocumentCommentAuthorOut(BaseModel):
    """Author information for a comment."""
    id: int
    full_name: Optional[str]
    email: str

    class Config:
        from_attributes = True


class DocumentCommentOut(BaseModel):
    """Schema for document comment output."""
    id: int
    document_id: int
    assignment_id: int
    author_id: int
    author: DocumentCommentAuthorOut
    content: str
    lane: CommentLane
    parent_comment_id: Optional[int]
    thread_depth: int
    mentioned_user_ids: List[int]
    is_resolved: bool
    resolved_at: Optional[datetime]
    resolved_by_id: Optional[int]
    is_visible_to_client: bool
    is_edited: bool
    edited_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    reply_count: int = 0

    class Config:
        from_attributes = True


class DocumentCommentListResponse(BaseModel):
    """Response schema for listing document comments."""
    comments: List[DocumentCommentOut]
    total: int
    document_id: int


class ResolveCommentRequest(BaseModel):
    """Request schema for resolving/unresolving comments."""
    is_resolved: bool
