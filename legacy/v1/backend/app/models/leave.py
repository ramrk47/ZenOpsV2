from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Enum, Float, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin
from app.models.enums import LeaveStatus, LeaveType


class LeaveRequest(IDMixin, TimestampMixin, Base):
    __tablename__ = "leave_requests"

    requester_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    leave_type: Mapped[LeaveType] = mapped_column(Enum(LeaveType, name="leave_type"), nullable=False, index=True)

    start_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)
    hours: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    status: Mapped[LeaveStatus] = mapped_column(
        Enum(LeaveStatus, name="leave_status"),
        default=LeaveStatus.PENDING,
        nullable=False,
        index=True,
    )
    approver_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    calendar_event_id: Mapped[Optional[int]] = mapped_column(ForeignKey("calendar_events.id"), nullable=True)

    requester: Mapped["User"] = relationship(back_populates="leave_requests", foreign_keys=[requester_user_id])
    approver: Mapped[Optional["User"]] = relationship(back_populates="leave_approvals", foreign_keys=[approver_user_id])
    calendar_event: Mapped[Optional["CalendarEvent"]] = relationship(back_populates="leave_request")
