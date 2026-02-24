"""
Approval model.

Captures approval requests for sensitive actions.  When a user performs
an operation that requires approval (e.g. deleting an assignment,
marking an invoice as paid), a corresponding record is created.  An
approver user will then approve or reject the request.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from sqlalchemy import Column, Integer, String, Enum, ForeignKey, DateTime, Text
from sqlalchemy.orm import relationship

from .base import Base


class ApprovalStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class Approval(Base):
    __tablename__ = "approvals"

    id: int = Column(Integer, primary_key=True)
    # Which entity is being acted on
    assignment_id = Column(Integer, ForeignKey("assignments.id"), nullable=True)
    assignment = relationship("Assignment", back_populates="approvals"). 
    entity_type: str = Column(String(50), nullable=False)  # e.g. ASSIGNMENT, INVOICE, USER
    entity_id: int = Column(Integer, nullable=False)
    action_type: str = Column(String(50), nullable=False)  # e.g. DELETE_ASSIGNMENT, MARK_PAID
    requester_user_id: int = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approver_user_id: int | None = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status: ApprovalStatus = Column(Enum(ApprovalStatus), nullable=False, default=ApprovalStatus.PENDING)
    reason: str | None = Column(Text, nullable=True)
    payload_json: str | None = Column(Text, nullable=True)
    created_at: datetime = Column(DateTime, default=datetime.utcnow, nullable=False)
    decided_at: datetime | None = Column(DateTime, nullable=True)

    requester = relationship("User", foreign_keys=[requester_user_id], back_populates="approvals_requested")
    approver = relationship("User", foreign_keys=[approver_user_id], back_populates="approvals_assigned")
    # optionally link to assignment if applicable (not enforced by FK due to polymorphism)
    assignment = relationship("Assignment", primaryjoin="foreign(Approval.entity_id)==Assignment.id", viewonly=True)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Approval id={self.id} entity={self.entity_type} action={self.action_type} status={self.status}>"