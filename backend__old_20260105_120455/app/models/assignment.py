"""
Assignment model.

Assignments are the core work unit within Zen Ops.  They capture all
relevant metadata about a valuation request and link to related tasks,
documents, messages, approvals, invoices and activity logs.
"""

from __future__ import annotations

from datetime import datetime, timedelta, time as dtime
from enum import StrEnum
from typing import Optional

from sqlalchemy import (
    Column,
    Integer,
    String,
    Enum,
    ForeignKey,
    Numeric,
    Date,
    DateTime,
    Boolean,
    Text,
)
from sqlalchemy.orm import relationship

from .base import Base


class AssignmentStatus(StrEnum):
    PENDING = "PENDING"
    SITE_VISIT = "SITE_VISIT"
    UNDER_PROCESS = "UNDER_PROCESS"
    SUBMITTED = "SUBMITTED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class CaseType(StrEnum):
    BANK = "BANK"
    EXTERNAL_VALUER = "EXTERNAL_VALUER"
    DIRECT_CLIENT = "DIRECT_CLIENT"


class Assignment(Base):
    __tablename__ = "assignments"

    id: int = Column(Integer, primary_key=True)
    assignment_code: str = Column(String(64), unique=True, nullable=False, index=True)
    case_type: CaseType = Column(Enum(CaseType), nullable=False, default=CaseType.BANK)

    # Foreign keys to master data
    bank_id: int | None = Column(Integer, ForeignKey("banks.id", ondelete="SET NULL"), nullable=True, index=True)
    branch_id: int | None = Column(Integer, ForeignKey("branches.id", ondelete="SET NULL"), nullable=True, index=True)
    client_id: int | None = Column(Integer, ForeignKey("clients.id", ondelete="SET NULL"), nullable=True, index=True)
    property_type_id: int | None = Column(Integer, ForeignKey("property_types.id", ondelete="SET NULL"), nullable=True, index=True)

    # Legacy denormalised fields
    bank_name: str | None = Column(String(200), nullable=True)
    branch_name: str | None = Column(String(200), nullable=True)
    valuer_client_name: str | None = Column(String(200), nullable=True)
    property_type: str | None = Column(String(100), nullable=True)

    borrower_name: str | None = Column(String(200), nullable=True)
    phone: str | None = Column(String(50), nullable=True)
    address: str | None = Column(Text, nullable=True)

    land_area: float | None = Column(Numeric(precision=12, scale=2), nullable=True)
    builtup_area: float | None = Column(Numeric(precision=12, scale=2), nullable=True)

    status: AssignmentStatus = Column(Enum(AssignmentStatus), nullable=False, default=AssignmentStatus.PENDING)

    # Ownership
    created_by_user_id: int | None = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    assigned_to_user_id: int | None = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    assigned_at: datetime | None = Column(DateTime, nullable=True)
    completed_at: datetime | None = Column(DateTime, nullable=True)
    report_submitted_at: datetime | None = Column(DateTime, nullable=True)

    site_visit_date: datetime | None = Column(DateTime, nullable=True)
    report_due_date: datetime | None = Column(DateTime, nullable=True)

    fees: float | None = Column(Numeric(precision=12, scale=2), nullable=True)
    is_paid: bool = Column(Boolean, nullable=False, default=False)

    notes: str | None = Column(Text, nullable=True)

    created_at: datetime = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: datetime = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    creator = relationship("User", back_populates="assignments_created", foreign_keys=[created_by_user_id])
    assignee = relationship("User", back_populates="assignments_assigned", foreign_keys=[assigned_to_user_id])
    bank = relationship("Bank")
    branch = relationship("Branch")
    client = relationship("Client")
    property_type_ref = relationship("PropertyType")
    documents = relationship("AssignmentDocument", back_populates="assignment", cascade="all, delete-orphan")
    tasks = relationship("AssignmentTask", back_populates="assignment", cascade="all, delete-orphan")
    messages = relationship("AssignmentMessage", back_populates="assignment", cascade="all, delete-orphan")
    approvals = relationship("Approval", back_populates="assignment", cascade="all, delete-orphan")
    activities = relationship("ActivityLog", back_populates="assignment", cascade="all, delete-orphan")
    invoice = relationship("Invoice", back_populates="assignment", uselist=False)

    # Calendar events associated with this assignment (e.g. site visits, report due)
    calendar_events = relationship("CalendarEvent", back_populates="assignment", cascade="all, delete-orphan")

    def _is_completed(self) -> bool:
        return self.status == AssignmentStatus.COMPLETED or self.completed_at is not None

    def _due_hours_policy(self) -> int:
        """Return default hours until due based on case type."""
        match self.case_type:
            case CaseType.BANK:
                return 48
            case CaseType.EXTERNAL_VALUER | CaseType.DIRECT_CLIENT:
                return 72
            case _:
                return 48

    @property
    def due_time(self) -> Optional[datetime]:
        """Calculate the due time for this assignment.

        Priority:
        1. If `report_due_date` is set, use that date at 18:00.
        2. Otherwise use `assigned_at` or `created_at` plus a policy window.
        """
        if self._is_completed():
            return None
        if self.report_due_date is not None:
            # combine date with fixed time 18:00 local (naive) time
            if isinstance(self.report_due_date, datetime):
                base_date = self.report_due_date.date()
            else:
                base_date = self.report_due_date
            return datetime.combine(base_date, dtime(hour=18, minute=0))
        base = self.assigned_at or self.created_at
        if base is None:
            return None
        return base + timedelta(hours=self._due_hours_policy())

    @property
    def due_state(self) -> str:
        """Return a human‑friendly state for the due time."""
        if self._is_completed():
            return "COMPLETED"
        dt = self.due_time
        if dt is None:
            return "NA"
        now = datetime.utcnow()
        if now > dt:
            return "OVERDUE"
        if dt - now <= timedelta(hours=6):
            return "DUE_SOON"
        return "OK"

    @property
    def minutes_left(self) -> Optional[int]:
        """Return minutes remaining until due (negative if overdue)."""
        dt = self.due_time
        if dt is None:
            return None
        delta = dt - datetime.utcnow()
        return int(delta.total_seconds() // 60)