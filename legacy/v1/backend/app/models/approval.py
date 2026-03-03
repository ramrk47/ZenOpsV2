from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Enum, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin
from app.models.enums import ApprovalActionType, ApprovalEntityType, ApprovalStatus, ApprovalType


class Approval(IDMixin, TimestampMixin, Base):
    __tablename__ = "approvals"

    approval_type: Mapped[Optional[ApprovalType]] = mapped_column(
        Enum(ApprovalType, name="approval_type"),
        nullable=True,
        index=True,
    )

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

    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    requester_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    approver_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)

    status: Mapped[ApprovalStatus] = mapped_column(
        Enum(ApprovalStatus, name="approval_status"),
        default=ApprovalStatus.PENDING,
        nullable=False,
    )
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    decision_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    payload_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    metadata_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Optional direct linkage for convenience
    assignment_id: Mapped[Optional[int]] = mapped_column(ForeignKey("assignments.id"), nullable=True, index=True)

    requester: Mapped["User"] = relationship(back_populates="approvals_requested", foreign_keys=[requester_user_id])
    approver: Mapped[Optional["User"]] = relationship(
        back_populates="approvals_to_decide",
        foreign_keys=[approver_user_id],
    )
    assignment: Mapped[Optional["Assignment"]] = relationship(back_populates="approvals")

    @property
    def requested_by_user_id(self) -> int:
        return self.requester_user_id

    @property
    def decided_by_user_id(self) -> Optional[int]:
        return self.approver_user_id
