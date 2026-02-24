from __future__ import annotations

from decimal import Decimal
from typing import List, Optional

from sqlalchemy import Boolean, Enum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin
from app.models.enums import CalendarEventType, CaseType


class Bank(IDMixin, TimestampMixin, Base):
    __tablename__ = "banks"

    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    code: Mapped[Optional[str]] = mapped_column(String(50), unique=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    branches: Mapped[List["Branch"]] = relationship(back_populates="bank", cascade="all, delete-orphan")
    checklist_templates: Mapped[List["DocumentChecklistTemplate"]] = relationship(
        back_populates="bank", cascade="all, delete-orphan"
    )


class Branch(IDMixin, TimestampMixin, Base):
    __tablename__ = "branches"

    bank_id: Mapped[int] = mapped_column(ForeignKey("banks.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    bank: Mapped[Bank] = relationship(back_populates="branches")
    checklist_templates: Mapped[List["DocumentChecklistTemplate"]] = relationship(
        back_populates="branch", cascade="all, delete-orphan"
    )


class Client(IDMixin, TimestampMixin, Base):
    __tablename__ = "clients"

    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    client_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    contact_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    contact_phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    contact_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    
    document_templates: Mapped[List["DocumentTemplate"]] = relationship(
        back_populates="client", cascade="all, delete-orphan"
    )


class PropertyType(IDMixin, TimestampMixin, Base):
    __tablename__ = "property_types"

    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    subtypes: Mapped[List["PropertySubtype"]] = relationship(
        back_populates="property_type",
        cascade="all, delete-orphan",
    )
    document_templates: Mapped[List["DocumentTemplate"]] = relationship(
        back_populates="property_type", cascade="all, delete-orphan"
    )


class PropertySubtype(IDMixin, TimestampMixin, Base):
    __tablename__ = "property_subtypes"
    __table_args__ = (
        UniqueConstraint("property_type_id", "name", name="uq_property_subtypes_type_name"),
    )

    property_type_id: Mapped[int] = mapped_column(
        ForeignKey("property_types.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    property_type: Mapped[PropertyType] = relationship(back_populates="subtypes")
    checklist_templates: Mapped[List["DocumentChecklistTemplate"]] = relationship(
        back_populates="property_subtype",
        cascade="all, delete-orphan",
    )


class CompanyAccount(IDMixin, TimestampMixin, Base):
    __tablename__ = "company_accounts"

    bank_id: Mapped[Optional[int]] = mapped_column(ForeignKey("banks.id", ondelete="SET NULL"), nullable=True, index=True)
    account_name: Mapped[str] = mapped_column(String(255), nullable=False)
    account_number: Mapped[str] = mapped_column(String(100), nullable=False)
    ifsc_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    bank_name: Mapped[str] = mapped_column(String(255), nullable=False)
    branch_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    upi_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    bank: Mapped[Optional[Bank]] = relationship()


class CompanyProfile(IDMixin, TimestampMixin, Base):
    __tablename__ = "company_profiles"

    business_name: Mapped[str] = mapped_column(String(255), nullable=False)
    legal_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    tagline: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    address_line1: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    address_line2: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    state_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    state_code: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    postal_code: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    country: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    gstin: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    pan: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    contact_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    contact_phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    website: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    default_gst_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class CalendarEventLabel(IDMixin, TimestampMixin, Base):
    __tablename__ = "calendar_event_labels"

    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    default_event_type: Mapped[CalendarEventType] = mapped_column(
        Enum(CalendarEventType, name="calendar_event_type"),
        default=CalendarEventType.INTERNAL_MEETING,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    events: Mapped[List["CalendarEvent"]] = relationship(back_populates="event_label")


class DocumentChecklistTemplate(IDMixin, TimestampMixin, Base):
    __tablename__ = "document_checklist_templates"

    bank_id: Mapped[Optional[int]] = mapped_column(ForeignKey("banks.id", ondelete="CASCADE"), nullable=True)
    branch_id: Mapped[Optional[int]] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"), nullable=True)
    property_type_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("property_types.id", ondelete="CASCADE"), nullable=True
    )
    property_subtype_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("property_subtypes.id", ondelete="CASCADE"), nullable=True
    )
    case_type: Mapped[Optional[CaseType]] = mapped_column(Enum(CaseType, name="case_type"), nullable=True)
    category: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    required: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    bank: Mapped[Optional[Bank]] = relationship(back_populates="checklist_templates")
    branch: Mapped[Optional[Branch]] = relationship(back_populates="checklist_templates")
    property_type: Mapped[Optional[PropertyType]] = relationship()
    property_subtype: Mapped[Optional[PropertySubtype]] = relationship(back_populates="checklist_templates")
