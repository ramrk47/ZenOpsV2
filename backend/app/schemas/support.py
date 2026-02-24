"""Pydantic schemas for support system."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import AuthorType, SupportPriority, SupportThreadStatus


# Support Thread Schemas

class SupportThreadBase(BaseModel):
    subject: str = Field(..., min_length=1, max_length=500)
    assignment_id: Optional[int] = None
    priority: SupportPriority = SupportPriority.MEDIUM


class SupportThreadCreate(SupportThreadBase):
    initial_message: str = Field(..., min_length=1)


class SupportThreadUpdate(BaseModel):
    status: Optional[SupportThreadStatus] = None
    priority: Optional[SupportPriority] = None


class SupportThreadResponse(SupportThreadBase):
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    created_by_user_id: int
    created_via: AuthorType
    status: SupportThreadStatus
    last_message_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    
    # Optional expanded fields
    message_count: Optional[int] = None
    assignment_code: Optional[str] = None


class SupportThreadDetail(SupportThreadResponse):
    """Full thread details with messages."""
    messages: list["SupportMessageResponse"] = []


# Support Message Schemas

class SupportMessageBase(BaseModel):
    message_text: str = Field(..., min_length=1)
    attachments_json: Optional[dict] = None


class SupportMessageCreate(SupportMessageBase):
    pass


class SupportMessageResponse(SupportMessageBase):
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    thread_id: int
    author_user_id: Optional[int] = None
    author_type: AuthorType
    author_label: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# Support Token Schemas

class SupportTokenCreate(BaseModel):
    assignment_id: Optional[int] = None
    thread_id: Optional[int] = None
    expires_in_days: int = Field(default=7, ge=1, le=30)


class SupportTokenResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    token: str  # Only included when first created
    expires_at: datetime
    assignment_id: Optional[int] = None
    thread_id: Optional[int] = None


class SupportTokenContext(BaseModel):
    """Context information returned when validating a token."""
    token_id: int
    assignment_id: Optional[int] = None
    thread_id: Optional[int] = None
    expires_at: str
    used_count: int
    assignment: Optional[dict] = None
    thread: Optional[dict] = None


# External Portal Schemas

class ExternalSupportThreadCreate(BaseModel):
    """Create support thread from external portal."""
    token: str
    subject: str = Field(..., min_length=1, max_length=500)
    message: str = Field(..., min_length=1)
    priority: SupportPriority = SupportPriority.MEDIUM


class ExternalSupportMessageCreate(BaseModel):
    """Create message from external portal."""
    token: str
    message: str = Field(..., min_length=1)


# System Config Schemas

class SystemConfigUpdate(BaseModel):
    config_value: str


class SystemConfigResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    config_key: str
    config_value: Optional[str] = None
    config_type: str
    is_public: bool
    description: Optional[str] = None


class PublicConfigResponse(BaseModel):
    """Public configuration values exposed to frontend."""
    whatsapp_number: str
    support_bubble_enabled: bool
