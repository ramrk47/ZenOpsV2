"""
Leave request schemas.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel

from ..models.leave import LeaveType, LeaveStatus


class LeaveRequestCreate(BaseModel):
    leave_type: LeaveType
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    hours: Optional[float] = None
    reason: Optional[str] = None

    class Config:
        from_attributes = True


class LeaveRequestRead(BaseModel):
    id: int
    requester_user_id: int
    leave_type: LeaveType
    start_date: Optional[date]
    end_date: Optional[date]
    hours: Optional[float]
    reason: Optional[str]
    status: LeaveStatus
    approver_user_id: Optional[int]
    created_at: datetime
    decided_at: Optional[datetime]

    class Config:
        from_attributes = True