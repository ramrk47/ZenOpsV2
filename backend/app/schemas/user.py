from __future__ import annotations

import re
from datetime import datetime
from typing import Optional, Dict, List

from pydantic import Field, field_validator

from app.models.enums import Role
from app.schemas.base import ORMModel


def _validate_password_strength(password: str) -> str:
    """Enforce password complexity: min 12 chars, upper, lower, digit, special."""
    if len(password) < 12:
        raise ValueError("Password must be at least 12 characters long")
    if not re.search(r"[A-Z]", password):
        raise ValueError("Password must contain at least one uppercase letter")
    if not re.search(r"[a-z]", password):
        raise ValueError("Password must contain at least one lowercase letter")
    if not re.search(r"\d", password):
        raise ValueError("Password must contain at least one digit")
    if not re.search(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>/?~`]", password):
        raise ValueError("Password must contain at least one special character")
    return password


class UserBase(ORMModel):
    email: str
    full_name: Optional[str] = None
    phone: Optional[str] = None
    role: Role = Role.EMPLOYEE
    roles: Optional[List[Role]] = None
    is_active: bool = True
    partner_id: Optional[int] = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        if "@" not in value:
            raise ValueError("Invalid email address")
        local, _, domain = value.partition("@")
        if not local or not domain:
            raise ValueError("Invalid email address")
        if "." not in domain and not domain.endswith(".local"):
            raise ValueError("Invalid email domain")
        return value.lower()


class UserCreate(UserBase):
    password: str = Field(..., min_length=12)
    capability_overrides: Optional[Dict[str, bool]] = None

    @field_validator("password")
    @classmethod
    def check_password_strength(cls, value: str) -> str:
        return _validate_password_strength(value)


class UserUpdate(ORMModel):
    email: Optional[str] = None
    full_name: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[Role] = None
    roles: Optional[List[Role]] = None
    is_active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=12)
    capability_overrides: Optional[Dict[str, bool]] = None
    partner_id: Optional[int] = None

    @field_validator("email")
    @classmethod
    def validate_optional_email(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if "@" not in value:
            raise ValueError("Invalid email address")
        local, _, domain = value.partition("@")
        if not local or not domain:
            raise ValueError("Invalid email address")
        if "." not in domain and not domain.endswith(".local"):
            raise ValueError("Invalid email domain")
        return value.lower()

    @field_validator("password")
    @classmethod
    def check_password_strength(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return _validate_password_strength(value)


class UserSelfUpdate(ORMModel):
    email: Optional[str] = None
    full_name: Optional[str] = None
    phone: Optional[str] = None
    password: Optional[str] = Field(default=None, min_length=12)
    current_password: Optional[str] = None
    whatsapp_opted_in: Optional[bool] = None
    whatsapp_number: Optional[str] = None

    @field_validator("email")
    @classmethod
    def validate_optional_email(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if "@" not in value:
            raise ValueError("Invalid email address")
        local, _, domain = value.partition("@")
        if not local or not domain:
            raise ValueError("Invalid email address")
        if "." not in domain and not domain.endswith(".local"):
            raise ValueError("Invalid email domain")
        return value.lower()

    @field_validator("password")
    @classmethod
    def check_password_strength(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return _validate_password_strength(value)


class UserRead(UserBase):
    id: int
    created_at: datetime
    updated_at: datetime
    last_login_at: Optional[datetime] = None
    capability_overrides: Optional[Dict[str, bool]] = None
    totp_enabled: bool = False
    whatsapp_opted_in: bool = False
    whatsapp_number: Optional[str] = None


class UserSummary(UserRead):
    open_assignments: int = 0
    overdue_assignments: int = 0
    on_leave_today: bool = False
    login_count_30d: int = 0
    active_days_30d: int = 0


class UserDirectory(ORMModel):
    id: int
    email: str
    full_name: Optional[str] = None
    role: Role
    is_active: bool
    last_login_at: Optional[datetime] = None


class ResetPasswordPayload(ORMModel):
    password: str = Field(..., min_length=12)

    @field_validator("password")
    @classmethod
    def check_password_strength(cls, value: str) -> str:
        return _validate_password_strength(value)
