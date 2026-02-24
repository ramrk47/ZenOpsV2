from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import Field, model_validator

from app.models.enums import LeaveStatus, LeaveType
from app.schemas.base import ORMModel


class LeaveRequestCreate(ORMModel):
    leave_type: LeaveType
    start_date: date
    end_date: Optional[date] = None
    hours: Optional[float] = Field(default=None, gt=0)
    reason: Optional[str] = None

    @model_validator(mode="after")
    def validate_leave(self) -> "LeaveRequestCreate":
        if self.leave_type in {LeaveType.FULL_DAY, LeaveType.HALF_DAY}:
            if self.end_date is None:
                self.end_date = self.start_date
            if self.end_date < self.start_date:
                raise ValueError("end_date cannot be before start_date")
        if self.leave_type == LeaveType.PERMISSION_HOURS:
            if not self.hours:
                raise ValueError("hours is required for PERMISSION_HOURS")
        return self


class LeaveRequestUpdate(ORMModel):
    leave_type: Optional[LeaveType] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    hours: Optional[float] = Field(default=None, gt=0)
    reason: Optional[str] = None
    status: Optional[LeaveStatus] = None
    approver_user_id: Optional[int] = None


class LeaveRequestRead(ORMModel):
    id: int
    requester_user_id: int
    leave_type: LeaveType
    start_date: date
    end_date: Optional[date] = None
    hours: Optional[float] = None
    reason: Optional[str] = None
    status: LeaveStatus
    approver_user_id: Optional[int] = None
    decided_at: Optional[datetime] = None
    calendar_event_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
