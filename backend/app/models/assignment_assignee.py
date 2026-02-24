from __future__ import annotations

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin


class AssignmentAssignee(IDMixin, TimestampMixin, Base):
    __tablename__ = "assignment_assignees"
    __table_args__ = (
        UniqueConstraint("assignment_id", "user_id", name="uq_assignment_assignees_assignment_user"),
    )

    assignment_id: Mapped[int] = mapped_column(
        ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    assignment: Mapped["Assignment"] = relationship(back_populates="assignment_assignees")
    user: Mapped["User"] = relationship(back_populates="assignment_assignee_links")
