"""
Leave request model.

Employees can request full day, half day or hourly leave.  Approved
leave is recorded on the calendar to ensure workloads reflect
availability.  HR and Admin roles can approve or reject requests.
"""

from __future__ import annotations

from datetime import datetime, date
from enum import StrEnum
from typing import Optional
from sqlalchemy import Column, Integer, Enum, ForeignKey, Date, Float, String, DateTime
from sqlalchemy.orm import relationship

from .base import Base


class LeaveType(StrEnum):
    FULL_DAY = "FULL_DAY"
    HALF_DAY = "HALF_DAY"
    PERMISSION_HOURS = "PERMISSION_HOURS"


class LeaveStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class LeaveRequest(Base):
    __tablename__ = "leave_requests"

    id: int = Column(Integer, primary_key=True, index=True)
    requester_user_id: int = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    leave_type: LeaveType = Column(Enum(LeaveType), nullable=False)
    start_date: date | None = Column(Date, nullable=True)
    end_date: date | None = Column(Date, nullable=True)
    hours: float | None = Column(Float, nullable=True)  # used for permission hours
    reason: str | None = Column(String(500), nullable=True)
    status: LeaveStatus = Column(Enum(LeaveStatus), nullable=False, default=LeaveStatus.PENDING)
    approver_user_id: int | None = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: datetime = Column(DateTime, default=datetime.utcnow, nullable=False)
    decided_at: datetime | None = Column(DateTime, nullable=True)

    requester = relationship("User", foreign_keys=[requester_user_id], back_populates="leaves")
    approver = relationship("User", foreign_keys=[approver_user_id])

    def __repr__(self) -> str:  # pragma: no cover
        return f"<LeaveRequest id={self.id} type={self.leave_type} status={self.status}>"