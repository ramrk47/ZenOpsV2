from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin
from app.models.enums import TaskStatus


class AssignmentTask(IDMixin, TimestampMixin, Base):
    __tablename__ = "assignment_tasks"

    assignment_id: Mapped[int] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    invoice_id: Mapped[Optional[int]] = mapped_column(ForeignKey("invoices.id"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[TaskStatus] = mapped_column(
        Enum(TaskStatus, name="task_status"),
        default=TaskStatus.TODO,
        nullable=False,
        index=True,
    )

    assigned_to_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    template_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    calendar_event_id: Mapped[Optional[int]] = mapped_column(ForeignKey("calendar_events.id"), nullable=True)

    assignment: Mapped["Assignment"] = relationship(back_populates="tasks")
    invoice: Mapped[Optional["Invoice"]] = relationship()
    creator: Mapped["User"] = relationship(back_populates="tasks_created", foreign_keys=[created_by_user_id])
    assignee: Mapped[Optional["User"]] = relationship(
        back_populates="tasks_assigned",
        foreign_keys=[assigned_to_user_id],
    )
    calendar_event: Mapped[Optional["CalendarEvent"]] = relationship(back_populates="task")
