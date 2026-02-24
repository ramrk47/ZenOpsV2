from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin
from app.models.assignment_assignee import AssignmentAssignee
from app.models.assignment_floor import AssignmentFloorArea
from app.models.enums import AssignmentStatus, CaseType, ServiceLine


class Assignment(IDMixin, TimestampMixin, Base):
    __tablename__ = "assignments"

    assignment_code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    case_type: Mapped[CaseType] = mapped_column(Enum(CaseType, name="case_type"), nullable=False, index=True)
    service_line: Mapped[ServiceLine] = mapped_column(
        Enum(ServiceLine, name="service_line"),
        default=ServiceLine.VALUATION,
        nullable=False,
        index=True,
    )

    partner_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("external_partners.id"),
        nullable=True,
        index=True,
    )
    commission_request_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("commission_requests.id"),
        nullable=True,
        index=True,
    )

    bank_id: Mapped[Optional[int]] = mapped_column(ForeignKey("banks.id"), nullable=True, index=True)
    branch_id: Mapped[Optional[int]] = mapped_column(ForeignKey("branches.id"), nullable=True, index=True)
    client_id: Mapped[Optional[int]] = mapped_column(ForeignKey("clients.id"), nullable=True, index=True)
    property_type_id: Mapped[Optional[int]] = mapped_column(ForeignKey("property_types.id"), nullable=True, index=True)
    property_subtype_id: Mapped[Optional[int]] = mapped_column(ForeignKey("property_subtypes.id"), nullable=True, index=True)

    # Legacy denormalized names for resilience and history
    bank_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    branch_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    valuer_client_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    property_type: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    borrower_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    land_area: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    builtup_area: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)

    status: Mapped[AssignmentStatus] = mapped_column(
        Enum(AssignmentStatus, name="assignment_status"),
        default=AssignmentStatus.PENDING,
        nullable=False,
        index=True,
    )

    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    assigned_to_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)

    assigned_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    report_submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    site_visit_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    report_due_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    fees: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    is_paid: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Soft delete keeps audit trail intact.
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)

    creator: Mapped["User"] = relationship(
        back_populates="assignments_created",
        foreign_keys=[created_by_user_id],
    )
    assignee: Mapped[Optional["User"]] = relationship(
        back_populates="assignments_assigned",
        foreign_keys=[assigned_to_user_id],
    )

    bank: Mapped[Optional["Bank"]] = relationship()
    branch: Mapped[Optional["Branch"]] = relationship()
    client: Mapped[Optional["Client"]] = relationship()
    property_type_ref: Mapped[Optional["PropertyType"]] = relationship()
    property_subtype_ref: Mapped[Optional["PropertySubtype"]] = relationship()

    documents: Mapped[List["AssignmentDocument"]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan"
    )
    tasks: Mapped[List["AssignmentTask"]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan"
    )
    messages: Mapped[List["AssignmentMessage"]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan"
    )
    approvals: Mapped[List["Approval"]] = relationship(back_populates="assignment")
    activities: Mapped[List["ActivityLog"]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan"
    )
    invoices: Mapped[List["Invoice"]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan"
    )
    calendar_events: Mapped[List["CalendarEvent"]] = relationship(back_populates="assignment")
    assignment_assignees: Mapped[List["AssignmentAssignee"]] = relationship(
        back_populates="assignment",
        cascade="all, delete-orphan",
    )
    floors: Mapped[List["AssignmentFloorArea"]] = relationship(
        back_populates="assignment",
        cascade="all, delete-orphan",
        order_by=lambda: AssignmentFloorArea.order_index.asc(),
    )

    partner: Mapped[Optional["ExternalPartner"]] = relationship()
    commission_request: Mapped[Optional["CommissionRequest"]] = relationship(
        foreign_keys=[commission_request_id],
    )
    support_threads: Mapped[List["SupportThread"]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan"
    )

    @property
    def additional_assignee_user_ids(self) -> list[int]:
        primary = self.assigned_to_user_id
        ids: set[int] = set()
        for link in self.assignment_assignees or []:
            if not link.user_id:
                continue
            if primary and link.user_id == primary:
                continue
            ids.add(int(link.user_id))
        return sorted(ids)

    @property
    def assignee_user_ids(self) -> list[int]:
        ids: set[int] = set(self.additional_assignee_user_ids)
        if self.assigned_to_user_id:
            ids.add(int(self.assigned_to_user_id))
        return sorted(ids)

    @property
    def property_subtype_name(self) -> Optional[str]:
        return self.property_subtype_ref.name if self.property_subtype_ref else None
