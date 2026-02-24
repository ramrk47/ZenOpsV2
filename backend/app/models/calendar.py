from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin
from app.models.enums import CalendarEventType


class CalendarEvent(IDMixin, TimestampMixin, Base):
    __tablename__ = "calendar_events"

    event_type: Mapped[CalendarEventType] = mapped_column(
        Enum(CalendarEventType, name="calendar_event_type"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    assignment_id: Mapped[Optional[int]] = mapped_column(ForeignKey("assignments.id"), nullable=True, index=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    assigned_to_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    assigned_to_all: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    assigned_user_ids: Mapped[Optional[List[int]]] = mapped_column(JSON, nullable=True)
    event_label_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("calendar_event_labels.id", ondelete="SET NULL"), nullable=True, index=True
    )

    payload_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    assignment: Mapped[Optional["Assignment"]] = relationship(back_populates="calendar_events")
    creator: Mapped["User"] = relationship(back_populates="calendar_events_created", foreign_keys=[created_by_user_id])
    assignee: Mapped[Optional["User"]] = relationship(
        back_populates="calendar_events_assigned",
        foreign_keys=[assigned_to_user_id],
    )
    event_label: Mapped[Optional["CalendarEventLabel"]] = relationship(back_populates="events")

    task: Mapped[Optional["AssignmentTask"]] = relationship(back_populates="calendar_event", uselist=False)
    leave_request: Mapped[Optional["LeaveRequest"]] = relationship(back_populates="calendar_event", uselist=False)

    @property
    def event_label_name(self) -> Optional[str]:
        return self.event_label.name if self.event_label else None
