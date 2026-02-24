from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin
from app.models.enums import (
    CommissionRequestStatus,
    PartnerRequestDirection,
    PartnerRequestEntityType,
    PartnerRequestStatus,
    PartnerRequestType,
    ServiceLine,
)


class ExternalPartner(IDMixin, TimestampMixin, Base):
    __tablename__ = "external_partners"

    display_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    legal_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    contact_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    alternate_contact_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    alternate_contact_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    alternate_contact_phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    billing_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    billing_city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    billing_state: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    billing_postal_code: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    gstin: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    default_payment_terms_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    service_lines: Mapped[Optional[list[str]]] = mapped_column(JSON, nullable=True)
    multi_floor_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    users: Mapped[List["User"]] = relationship(back_populates="partner")
    commission_requests: Mapped[List["CommissionRequest"]] = relationship(
        back_populates="partner", cascade="all, delete-orphan"
    )
    partner_requests: Mapped[List["PartnerRequest"]] = relationship(
        back_populates="partner", cascade="all, delete-orphan"
    )
    partner_deliverables: Mapped[List["PartnerDeliverable"]] = relationship(
        back_populates="partner", cascade="all, delete-orphan"
    )


class CommissionRequest(IDMixin, TimestampMixin, Base):
    __tablename__ = "commission_requests"

    request_code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    partner_id: Mapped[int] = mapped_column(ForeignKey("external_partners.id"), nullable=False, index=True)
    status: Mapped[CommissionRequestStatus] = mapped_column(
        Enum(CommissionRequestStatus, name="commission_status"),
        default=CommissionRequestStatus.DRAFT,
        nullable=False,
        index=True,
    )
    service_line: Mapped[Optional[ServiceLine]] = mapped_column(
        Enum(ServiceLine, name="service_line"),
        nullable=True,
        index=True,
    )

    bank_id: Mapped[Optional[int]] = mapped_column(ForeignKey("banks.id"), nullable=True, index=True)
    branch_id: Mapped[Optional[int]] = mapped_column(ForeignKey("branches.id"), nullable=True, index=True)
    client_id: Mapped[Optional[int]] = mapped_column(ForeignKey("clients.id"), nullable=True, index=True)
    property_type_id: Mapped[Optional[int]] = mapped_column(ForeignKey("property_types.id"), nullable=True, index=True)
    property_subtype_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("property_subtypes.id"), nullable=True, index=True
    )

    bank_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    branch_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    valuer_client_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    property_type: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    borrower_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    land_area: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    builtup_area: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)

    site_visit_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    report_due_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    admin_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    decision_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    converted_assignment_id: Mapped[Optional[int]] = mapped_column(ForeignKey("assignments.id"), nullable=True, index=True)

    partner: Mapped["ExternalPartner"] = relationship(back_populates="commission_requests")
    creator: Mapped["User"] = relationship()
    converted_assignment: Mapped[Optional["Assignment"]] = relationship(
        foreign_keys=[converted_assignment_id],
    )

    bank: Mapped[Optional["Bank"]] = relationship()
    branch: Mapped[Optional["Branch"]] = relationship()
    client: Mapped[Optional["Client"]] = relationship()
    property_type_ref: Mapped[Optional["PropertyType"]] = relationship()
    property_subtype_ref: Mapped[Optional["PropertySubtype"]] = relationship()

    documents: Mapped[List["CommissionRequestDocument"]] = relationship(
        back_populates="commission_request", cascade="all, delete-orphan"
    )
    floors: Mapped[List["CommissionRequestFloorArea"]] = relationship(
        back_populates="commission_request", cascade="all, delete-orphan"
    )


class CommissionRequestFloorArea(IDMixin, TimestampMixin, Base):
    __tablename__ = "commission_request_floor_areas"

    commission_request_id: Mapped[int] = mapped_column(
        ForeignKey("commission_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    floor_name: Mapped[str] = mapped_column(String(255), nullable=False)
    area: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    commission_request: Mapped["CommissionRequest"] = relationship(back_populates="floors")


class CommissionRequestDocument(IDMixin, TimestampMixin, Base):
    __tablename__ = "commission_request_documents"

    commission_request_id: Mapped[int] = mapped_column(
        ForeignKey("commission_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    uploaded_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    mime_type: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)

    commission_request: Mapped["CommissionRequest"] = relationship(back_populates="documents")
    uploader: Mapped["User"] = relationship()


class PartnerRequest(IDMixin, TimestampMixin, Base):
    __tablename__ = "partner_requests"

    partner_id: Mapped[int] = mapped_column(ForeignKey("external_partners.id"), nullable=False, index=True)
    direction: Mapped[PartnerRequestDirection] = mapped_column(
        Enum(PartnerRequestDirection, name="partner_request_direction"),
        nullable=False,
        index=True,
    )
    request_type: Mapped[PartnerRequestType] = mapped_column(
        Enum(PartnerRequestType, name="partner_request_type"),
        nullable=False,
        index=True,
    )
    entity_type: Mapped[PartnerRequestEntityType] = mapped_column(
        Enum(PartnerRequestEntityType, name="partner_request_entity_type"),
        nullable=False,
        index=True,
    )
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    status: Mapped[PartnerRequestStatus] = mapped_column(
        Enum(PartnerRequestStatus, name="partner_request_status"),
        default=PartnerRequestStatus.OPEN,
        nullable=False,
        index=True,
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    payload_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_by_partner_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    partner: Mapped["ExternalPartner"] = relationship(back_populates="partner_requests")
    attachments: Mapped[List["PartnerRequestAttachment"]] = relationship(
        back_populates="partner_request", cascade="all, delete-orphan"
    )


class PartnerRequestAttachment(IDMixin, TimestampMixin, Base):
    __tablename__ = "partner_request_attachments"

    partner_request_id: Mapped[int] = mapped_column(
        ForeignKey("partner_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    uploaded_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    uploaded_by_partner_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)

    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    mime_type: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)

    partner_request: Mapped["PartnerRequest"] = relationship(back_populates="attachments")


class PartnerDeliverable(IDMixin, TimestampMixin, Base):
    __tablename__ = "partner_deliverables"

    partner_id: Mapped[int] = mapped_column(ForeignKey("external_partners.id"), nullable=False, index=True)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("assignment_documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    released_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    released_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)

    partner: Mapped["ExternalPartner"] = relationship(back_populates="partner_deliverables")
    assignment: Mapped["Assignment"] = relationship()
    document: Mapped["AssignmentDocument"] = relationship()
