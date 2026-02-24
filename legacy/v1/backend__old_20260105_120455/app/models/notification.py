"""
Notification model.

Notifications alert users about important events such as missing
documents, approaching SLA deadlines, overdue tasks, pending payments or
approvals.  Notifications may include a payload JSON with additional
context to help the frontend navigate to the relevant record.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from sqlalchemy import Column, Integer, ForeignKey, DateTime, Enum, String, Text
from sqlalchemy.orm import relationship

from .base import Base


class NotificationType(StrEnum):
    MISSING_DOC = "MISSING_DOC"
    SLA_DUE_SOON = "SLA_DUE_SOON"
    SLA_OVERDUE = "SLA_OVERDUE"
    PAYMENT_PENDING = "PAYMENT_PENDING"
    APPROVAL_PENDING = "APPROVAL_PENDING"


class Notification(Base):
    __tablename__ = "notifications"

    id: int = Column(Integer, primary_key=True, index=True)
    user_id: int = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type: NotificationType = Column(Enum(NotificationType), nullable=False)
    message: str = Column(String(500), nullable=False)
    read_at: datetime | None = Column(DateTime, nullable=True)
    payload_json: str | None = Column(Text, nullable=True)
    created_at: datetime = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Notification id={self.id} type={self.type} read={self.read_at is not None}>"