from __future__ import annotations

from typing import List, Optional

from sqlalchemy import Boolean, ForeignKey, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin


class AssignmentMessage(IDMixin, TimestampMixin, Base):
    __tablename__ = "assignment_messages"

    assignment_id: Mapped[int] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    sender_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    message: Mapped[str] = mapped_column(Text, nullable=False)
    mentions: Mapped[Optional[List[int]]] = mapped_column(JSON, nullable=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)

    assignment: Mapped["Assignment"] = relationship(back_populates="messages")
    sender: Mapped["User"] = relationship(back_populates="messages_sent")
