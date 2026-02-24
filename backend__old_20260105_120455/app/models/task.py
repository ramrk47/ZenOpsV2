"""
AssignmentTask model.

Represents small units of work tied to an assignment.  Tasks can be
assigned to different users and track their own status and due dates.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from sqlalchemy import Column, Integer, String, ForeignKey, Enum, DateTime, Text
from sqlalchemy.orm import relationship

from .base import Base


class TaskStatus(StrEnum):
    TODO = "TODO"
    DOING = "DOING"
    DONE = "DONE"
    BLOCKED = "BLOCKED"


class AssignmentTask(Base):
    __tablename__ = "assignment_tasks"

    id: int = Column(Integer, primary_key=True)
    assignment_id: int = Column(Integer, ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    title: str = Column(String(255), nullable=False)
    description: str | None = Column(Text, nullable=True)
    status: TaskStatus = Column(Enum(TaskStatus), nullable=False, default=TaskStatus.TODO)
    assigned_to_user_id: int | None = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    due_at: datetime | None = Column(DateTime, nullable=True)
    created_by_user_id: int | None = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: datetime = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: datetime = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    template_type: str | None = Column(String(50), nullable=True)

    assignment = relationship("Assignment", back_populates="tasks")
    assignee = relationship("User", foreign_keys=[assigned_to_user_id], back_populates="tasks_assigned")
    creator = relationship("User", foreign_keys=[created_by_user_id], back_populates="tasks_created")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AssignmentTask id={self.id} title={self.title} status={self.status}>"