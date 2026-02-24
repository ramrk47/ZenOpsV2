"""
Activity log model.

Captures a chronological record of actions taken within the system.  The
frontend can display these entries as a timeline on the assignment
detail page.
"""

from __future__ import annotations

from datetime import datetime
from sqlalchemy import Column, Integer, ForeignKey, DateTime, String, Text
from sqlalchemy.orm import relationship

from .base import Base


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id: int = Column(Integer, primary_key=True, index=True)
    assignment_id: int | None = Column(Integer, ForeignKey("assignments.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_user_id: int | None = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    type: str = Column(String(100), nullable=False)
    payload_json: str | None = Column(Text, nullable=True)
    created_at: datetime = Column(DateTime, default=datetime.utcnow, nullable=False)

    assignment = relationship("Assignment", back_populates="activities")
    actor = relationship("User")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<ActivityLog id={self.id} type={self.type}>"