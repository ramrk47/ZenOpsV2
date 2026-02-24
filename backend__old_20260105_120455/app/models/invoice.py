"""
Invoice models.

Invoices document the fees charged for assignments.  Each invoice is
linked to exactly one assignment and may include multiple line items.  It
stores the bank/branch/client context at the time of issue and tracks
payment status.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from sqlalchemy import Column, Integer, String, Numeric, DateTime, ForeignKey, Enum, Boolean
from sqlalchemy.orm import relationship

from .base import Base


class InvoiceStatus(StrEnum):
    DRAFT = "DRAFT"
    ISSUED = "ISSUED"
    PAID = "PAID"
    CANCELLED = "CANCELLED"


class Invoice(Base):
    __tablename__ = "invoices"

    id: int = Column(Integer, primary_key=True, index=True)
    invoice_number: str = Column(String(64), unique=True, nullable=False, index=True)
    assignment_id: int = Column(Integer, ForeignKey("assignments.id", ondelete="CASCADE"), unique=True, nullable=False)
    bank_id: int | None = Column(Integer, ForeignKey("banks.id", ondelete="SET NULL"), nullable=True)
    branch_id: int | None = Column(Integer, ForeignKey("branches.id", ondelete="SET NULL"), nullable=True)
    client_id: int | None = Column(Integer, ForeignKey("clients.id", ondelete="SET NULL"), nullable=True)
    total_amount: float | None = Column(Numeric(precision=12, scale=2), nullable=True)
    tax_amount: float | None = Column(Numeric(precision=12, scale=2), nullable=True)
    discount_amount: float | None = Column(Numeric(precision=12, scale=2), nullable=True)
    status: InvoiceStatus = Column(Enum(InvoiceStatus), nullable=False, default=InvoiceStatus.DRAFT)
    invoice_date: datetime | None = Column(DateTime, default=datetime.utcnow, nullable=True)
    due_date: datetime | None = Column(DateTime, nullable=True)
    notes: str | None = Column(String(500), nullable=True)
    created_by_user_id: int | None = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: datetime = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: datetime = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    assignment = relationship("Assignment", back_populates="invoice")
    bank = relationship("Bank")
    branch = relationship("Branch")
    client = relationship("Client")
    creator = relationship("User", back_populates="invoices_created")
    items = relationship("InvoiceItem", back_populates="invoice", cascade="all, delete-orphan")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Invoice id={self.id} invoice_number={self.invoice_number} status={self.status}>"


class InvoiceItem(Base):
    __tablename__ = "invoice_items"

    id: int = Column(Integer, primary_key=True, index=True)
    invoice_id: int = Column(Integer, ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True)
    description: str = Column(String(255), nullable=False)
    quantity: int = Column(Integer, nullable=False, default=1)
    unit_price: float = Column(Numeric(precision=12, scale=2), nullable=False, default=0)
    total_price: float = Column(Numeric(precision=12, scale=2), nullable=False, default=0)
    created_at: datetime = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: datetime = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    invoice = relationship("Invoice", back_populates="items")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<InvoiceItem id={self.id} description={self.description} qty={self.quantity} price={self.total_price}>"