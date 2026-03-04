"""Schemas for the public partner onboarding flow."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import EmailStr, Field

from app.schemas.base import ORMModel


class PartnerAccountRequestCreate(ORMModel):
    company_name: Optional[str] = Field(None, min_length=2, max_length=255)
    contact_name: Optional[str] = Field(None, min_length=2, max_length=255)
    firm_name: Optional[str] = Field(None, min_length=2, max_length=255)
    name: Optional[str] = Field(None, min_length=2, max_length=255)
    email: EmailStr
    phone: Optional[str] = Field(None, max_length=50)
    city: Optional[str] = Field(None, max_length=120)
    role_intent: Optional[str] = Field(None, max_length=100)
    requested_interface: Optional[str] = Field(None, max_length=50)
    message: Optional[str] = Field(None, max_length=2000)
    captcha_token: Optional[str] = Field(None, max_length=2000)


class PartnerAccountRequestRead(ORMModel):
    id: int
    company_name: str
    contact_name: str
    email: str
    phone: Optional[str] = None
    city: Optional[str] = None
    message: Optional[str] = None
    role_intent: Optional[str] = None
    requested_interface: Optional[str] = None
    metadata_json: Optional[dict] = None
    status: str
    token_expires_at: Optional[datetime] = None
    token_consumed_at: Optional[datetime] = None
    email_verified_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    reviewed_by_user_id: Optional[int] = None
    reviewed_at: Optional[datetime] = None
    created_user_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime


class PartnerAccountRequestDecision(ORMModel):
    rejection_reason: Optional[str] = Field(None, max_length=1000)


class PartnerAccessVerifyPayload(ORMModel):
    token: str = Field(..., min_length=10, max_length=256)


class PartnerAccessResendPayload(ORMModel):
    email: EmailStr
