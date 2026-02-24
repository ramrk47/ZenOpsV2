"""
AssignmentMessage model.

This model stores chat messages attached to an assignment.  Messages
record which user sent them and when.  Pinned messages float to the
top in the UI.  Mentions can be parsed client‑side for now.
"""

from __future__ import annotations

from datetime import datetime
from sqlalchemy import Column, Integer, ForeignKey, Text, Boolean, DateTime
from sqlalchemy.orm import relationship

from .base import Base


class AssignmentMessage(Base):
    __tablename__ = "assignment_messages"

    id: int = Column(Integer, primary_key=True)
    assignment_id: int = Column(Integer, ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    sender_user_id: int = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    message: str = Column(Text, nullable=False)
    pinned: bool = Column(Boolean, nullable=False, default=False)
    created_at: datetime = Column(DateTime, default=datetime.utcnow, nullable=False)

    assignment = relationship("Assignment", back_populates="messages")
    sender = relationship("User", back_populates="messages_sent")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AssignmentMessage id={self.id} pinned={self.pinned}>"