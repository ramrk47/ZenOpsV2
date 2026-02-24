from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Integer, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin
from app.models.enums import InvoiceAdjustmentType, InvoiceStatus, PaymentMode


class Invoice(IDMixin, TimestampMixin, Base):
    __tablename__ = "invoices"

    assignment_id: Mapped[int] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    partner_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("external_partners.id"),
        nullable=True,
        index=True,
    )
    invoice_number: Mapped[Optional[str]] = mapped_column(String(100), unique=True, nullable=True, index=True)

    currency: Mapped[str] = mapped_column(String(3), default="INR", nullable=False)

    issued_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)

    status: Mapped[InvoiceStatus] = mapped_column(
        Enum(InvoiceStatus, name="invoice_status"),
        default=InvoiceStatus.DRAFT,
        nullable=False,
        index=True,
    )

    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    amount_paid: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    amount_due: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    amount_credited: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)

    is_paid: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    bill_to_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    bill_to_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    bill_to_gstin: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    place_of_supply: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    terms: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    company_account_id: Mapped[Optional[int]] = mapped_column(ForeignKey("company_accounts.id"), nullable=True, index=True)
    bank_id: Mapped[Optional[int]] = mapped_column(ForeignKey("banks.id"), nullable=True, index=True)
    branch_id: Mapped[Optional[int]] = mapped_column(ForeignKey("branches.id"), nullable=True, index=True)
    client_id: Mapped[Optional[int]] = mapped_column(ForeignKey("clients.id"), nullable=True, index=True)

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    pdf_generated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    pdf_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    pdf_generated_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    voided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    void_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    voided_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)

    assignment: Mapped["Assignment"] = relationship(back_populates="invoices")
    partner: Mapped[Optional["ExternalPartner"]] = relationship()
    creator: Mapped["User"] = relationship(back_populates="invoices_created", foreign_keys=[created_by_user_id])
    company_account: Mapped[Optional["CompanyAccount"]] = relationship()
    bank: Mapped[Optional["Bank"]] = relationship()
    branch: Mapped[Optional["Branch"]] = relationship()
    client: Mapped[Optional["Client"]] = relationship()
    pdf_generator: Mapped[Optional["User"]] = relationship(
        back_populates="invoices_pdf_generated",
        foreign_keys=[pdf_generated_by_user_id],
    )
    voided_by: Mapped[Optional["User"]] = relationship(foreign_keys=[voided_by_user_id])
    items: Mapped[List["InvoiceItem"]] = relationship(back_populates="invoice", cascade="all, delete-orphan")
    payments: Mapped[List["InvoicePayment"]] = relationship(back_populates="invoice", cascade="all, delete-orphan")
    adjustments: Mapped[List["InvoiceAdjustment"]] = relationship(back_populates="invoice", cascade="all, delete-orphan")
    tax_breakdowns: Mapped[List["InvoiceTaxBreakdown"]] = relationship(
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by=lambda: InvoiceTaxBreakdown.created_at.asc(),
    )
    audit_logs: Mapped[List["InvoiceAuditLog"]] = relationship(
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by=lambda: InvoiceAuditLog.created_at.asc(),
    )
    attachments: Mapped[List["InvoiceAttachment"]] = relationship(
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by=lambda: InvoiceAttachment.created_at.asc(),
    )

    @property
    def tax_total(self) -> Decimal:
        return self.tax_amount

    @property
    def grand_total(self) -> Decimal:
        return self.total_amount

    @property
    def assignment_code(self) -> Optional[str]:
        if self.assignment:
            return self.assignment.assignment_code
        return None

    @property
    def party_name(self) -> Optional[str]:
        if self.bill_to_name:
            return self.bill_to_name
        if self.assignment:
            return (
                self.assignment.borrower_name
                or self.assignment.valuer_client_name
                or self.assignment.bank_name
                or self.assignment.assignment_code
            )
        return None

    @property
    def bank_name(self) -> Optional[str]:
        if self.assignment and self.assignment.bank_name:
            return self.assignment.bank_name
        if self.bank:
            return self.bank.name
        return None

    @property
    def branch_name(self) -> Optional[str]:
        if self.assignment and self.assignment.branch_name:
            return self.assignment.branch_name
        if self.branch:
            return self.branch.name
        return None

    @property
    def audit_trail(self) -> list["InvoiceAuditLog"]:
        return list(self.audit_logs or [])

    @property
    def tax_breakdown(self) -> Optional["InvoiceTaxBreakdown"]:
        if not self.tax_breakdowns:
            return None
        return self.tax_breakdowns[-1]


class InvoiceItem(IDMixin, TimestampMixin, Base):
    __tablename__ = "invoice_items"

    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("1.00"), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tax_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    tax_rate: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True)
    service_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    invoice: Mapped[Invoice] = relationship(back_populates="items")


class InvoicePayment(IDMixin, TimestampMixin, Base):
    __tablename__ = "invoice_payments"

    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    mode: Mapped[PaymentMode] = mapped_column(Enum(PaymentMode, name="payment_mode"), default=PaymentMode.MANUAL, nullable=False)
    reference_no: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    invoice: Mapped[Invoice] = relationship(back_populates="payments")


class InvoiceAdjustment(IDMixin, TimestampMixin, Base):
    __tablename__ = "invoice_adjustments"

    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    adjustment_type: Mapped[InvoiceAdjustmentType] = mapped_column(
        Enum(InvoiceAdjustmentType, name="invoice_adjustment_type"),
        default=InvoiceAdjustmentType.CREDIT_NOTE,
        nullable=False,
    )
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    invoice: Mapped[Invoice] = relationship(back_populates="adjustments")


class InvoiceTaxBreakdown(IDMixin, TimestampMixin, Base):
    __tablename__ = "invoice_tax_breakdowns"

    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True)
    taxable_value: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    cgst: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    sgst: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    igst: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    cess: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)

    invoice: Mapped[Invoice] = relationship(back_populates="tax_breakdowns")


class InvoiceAuditLog(IDMixin, TimestampMixin, Base):
    __tablename__ = "invoice_audit_logs"

    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    actor_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    diff_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    invoice: Mapped[Invoice] = relationship(back_populates="audit_logs")


class InvoiceAttachment(IDMixin, TimestampMixin, Base):
    __tablename__ = "invoice_attachments"

    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True)
    uploaded_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    mime_type: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)

    invoice: Mapped[Invoice] = relationship(back_populates="attachments")


class InvoiceSequence(IDMixin, TimestampMixin, Base):
    __tablename__ = "invoice_sequences"

    financial_year: Mapped[str] = mapped_column(String(10), nullable=False, unique=True, index=True)
    last_number: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
