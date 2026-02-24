"""Schemas for the public partner onboarding flow."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import EmailStr, Field

from app.schemas.base import ORMModel


class PartnerAccountRequestCreate(ORMModel):
    company_name: str = Field(..., min_length=2, max_length=255)
    contact_name: str = Field(..., min_length=2, max_length=255)
    email: EmailStr
    phone: Optional[str] = Field(None, max_length=50)
    message: Optional[str] = Field(None, max_length=2000)


class PartnerAccountRequestRead(ORMModel):
    id: int
    company_name: str
    contact_name: str
    email: str
    phone: Optional[str] = None
    message: Optional[str] = None
    status: str
    rejection_reason: Optional[str] = None
    reviewed_by_user_id: Optional[int] = None
    reviewed_at: Optional[datetime] = None
    created_user_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime


class PartnerAccountRequestDecision(ORMModel):
    rejection_reason: Optional[str] = Field(None, max_length=1000)
