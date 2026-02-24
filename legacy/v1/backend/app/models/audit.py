from __future__ import annotations

from typing import Optional

from sqlalchemy import ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin


class ActivityLog(IDMixin, TimestampMixin, Base):
    __tablename__ = "activity_logs"

    assignment_id: Mapped[Optional[int]] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), nullable=True, index=True)
    actor_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    payload_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    assignment: Mapped[Optional["Assignment"]] = relationship(back_populates="activities")
    actor: Mapped[Optional["User"]] = relationship(back_populates="activities")
