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

    @property
    def requested_by_name(self) -> Optional[str]:
        if self.requester:
            return self.requester.full_name or self.requester.email
        return None

    @property
    def assignment_code(self) -> Optional[str]:
        meta = self.metadata_json or {}
        payload = self.payload_json or {}
        if meta.get("assignment_code"):
            return str(meta["assignment_code"])
        if payload.get("assignment_code"):
            return str(payload["assignment_code"])
        if payload.get("temporary_code"):
            return str(payload["temporary_code"])
        if self.assignment and self.assignment.assignment_code:
            return self.assignment.assignment_code
        return None

    @property
    def invoice_number(self) -> Optional[str]:
        meta = self.metadata_json or {}
        payload = self.payload_json or {}
        if meta.get("invoice_number"):
            return str(meta["invoice_number"])
        if payload.get("invoice_number"):
            return str(payload["invoice_number"])
        return None

    @property
    def document_title(self) -> Optional[str]:
        meta = self.metadata_json or {}
        payload = self.payload_json or {}
        value = meta.get("document_name") or meta.get("document_title") or payload.get("document_name")
        if value is None:
            return None
        return str(value)

    @property
    def document_category(self) -> Optional[str]:
        meta = self.metadata_json or {}
        payload = self.payload_json or {}
        value = meta.get("category") or payload.get("category")
        if value is None:
            return None
        return str(value)

    @property
    def entity_summary(self) -> str:
        parts: list[str] = []
        if self.assignment_code:
            parts.append(self.assignment_code)
        if self.invoice_number:
            parts.append(f"Invoice {self.invoice_number}")
        if self.document_title:
            parts.append(self.document_title)
        elif self.document_category:
            parts.append(self.document_category)
        if parts:
            return " · ".join(parts)
        return f"{self.entity_type} #{self.entity_id}"
