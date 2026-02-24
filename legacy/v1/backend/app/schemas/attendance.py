"""Schemas for attendance / work session endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from app.schemas.base import ORMModel


class WorkSessionRead(ORMModel):
    id: int
    user_id: int
    login_at: datetime
    last_seen_at: datetime
    logout_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None
    session_type: str = "AUTO"
    created_at: datetime
    updated_at: datetime


class AttendanceSummary(ORMModel):
    user_id: int
    full_name: Optional[str] = None
    email: Optional[str] = None
    total_sessions: int = 0
    total_minutes: int = 0
    first_login: Optional[datetime] = None
    last_seen: Optional[datetime] = None
