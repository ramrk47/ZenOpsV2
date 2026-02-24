"""
CalendarEvent model.

Events represent scheduled items such as site visits, report deadlines,
document pickups, internal meetings and staff leave.  Leave events are
automatically created when leave requests are approved.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from sqlalchemy import Column, Integer, Enum, DateTime, String, ForeignKey
from sqlalchemy.orm import relationship

from .base import Base


class EventType(StrEnum):
    SITE_VISIT = "SITE_VISIT"
    REPORT_DUE = "REPORT_DUE"
    DOC_PICKUP = "DOC_PICKUP"
    INTERNAL_MEETING = "INTERNAL_MEETING"
    LEAVE = "LEAVE"


class CalendarEvent(Base):
    __tablename__ = "calendar_events"

    id: int = Column(Integer, primary_key=True, index=True)
    event_type: EventType = Column(Enum(EventType), nullable=False)
    title: str = Column(String(255), nullable=False)
    start_at: datetime = Column(DateTime, nullable=False)
    end_at: datetime = Column(DateTime, nullable=False)
    assignment_id: int | None = Column(Integer, ForeignKey("assignments.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by_user_id: int | None = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    assigned_to_user_id: int | None = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: datetime = Column(DateTime, default=datetime.utcnow, nullable=False)

    assignment = relationship("Assignment", back_populates="calendar_events", foreign_keys=[assignment_id])
    creator = relationship("User", back_populates="calendar_events_created", foreign_keys=[created_by_user_id])
    assignee = relationship("User", back_populates="calendar_events_assigned", foreign_keys=[assigned_to_user_id])

    def __repr__(self) -> str:  # pragma: no cover
        return f"<CalendarEvent id={self.id} type={self.event_type} start={self.start_at}>"