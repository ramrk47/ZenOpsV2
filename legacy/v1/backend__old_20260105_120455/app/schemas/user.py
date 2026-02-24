"""
User schemas.

These Pydantic models define the shape of user objects in API requests
and responses.  Passwords are only accepted on creation and never
returned in responses.
"""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field
from typing import Optional

from ..models.user import UserRole


class UserBase(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None
    role: UserRole = UserRole.EMPLOYEE
    is_active: bool = True

    class Config:
        from_attributes = True


class UserCreate(UserBase):
    password: str = Field(min_length=6)


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=6)

    class Config:
        from_attributes = True


class UserRead(UserBase):
    id: int

    class Config:
        from_attributes = True