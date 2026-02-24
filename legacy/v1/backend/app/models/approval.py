from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Enum, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin
from app.models.enums import ApprovalActionType, ApprovalEntityType, ApprovalStatus


class Approval(IDMixin, TimestampMixin, Base):
    __tablename__ = "approvals"

    entity_type: Mapped[ApprovalEntityType] = mapped_column(
        Enum(ApprovalEntityType, name="approval_entity_type"),
        nullable=False,
        index=True,
    )
    entity_id: Mapped[int] = mapped_column(nullable=False, index=True)
    action_type: Mapped[ApprovalActionType] = mapped_column(
        Enum(ApprovalActionType, name="approval_action_type"),
        nullable=False,
        index=True,
    )

    requester_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    approver_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)

    status: Mapped[ApprovalStatus] = mapped_column(
        Enum(ApprovalStatus, name="approval_status"),
        default=ApprovalStatus.PENDING,
        nullable=False,
    )
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    payload_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Optional direct linkage for convenience
    assignment_id: Mapped[Optional[int]] = mapped_column(ForeignKey("assignments.id"), nullable=True, index=True)

    requester: Mapped["User"] = relationship(back_populates="approvals_requested", foreign_keys=[requester_user_id])
    approver: Mapped[Optional["User"]] = relationship(
        back_populates="approvals_to_decide",
        foreign_keys=[approver_user_id],
    )
    assignment: Mapped[Optional["Assignment"]] = relationship(back_populates="approvals")
