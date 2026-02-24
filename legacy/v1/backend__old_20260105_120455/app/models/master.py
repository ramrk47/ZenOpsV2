"""
Master data models: Bank, Branch, Client and PropertyType.

Banks and branches include account details used for invoicing.  Clients
and property types are simple reference tables.
"""

from __future__ import annotations

from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, UniqueConstraint, DateTime
from sqlalchemy.orm import relationship

from .base import Base


class Bank(Base):
    __tablename__ = "banks"

    id: int = Column(Integer, primary_key=True, index=True)
    name: str = Column(String(200), nullable=False, unique=True, index=True)

    # Account details for invoicing
    account_name: str | None = Column(String(200), nullable=True)
    account_number: str | None = Column(String(50), nullable=True)
    ifsc: str | None = Column(String(20), nullable=True)
    account_bank_name: str | None = Column(String(200), nullable=True)
    account_branch_name: str | None = Column(String(200), nullable=True)
    upi_id: str | None = Column(String(100), nullable=True)
    invoice_notes: str | None = Column(String(500), nullable=True)

    created_at: datetime = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: datetime = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    branches = relationship("Branch", back_populates="bank", cascade="all, delete-orphan")


class Branch(Base):
    __tablename__ = "branches"
    __table_args__ = (UniqueConstraint("bank_id", "name", name="uq_branch_bank_name"),)

    id: int = Column(Integer, primary_key=True, index=True)
    bank_id: int = Column(Integer, ForeignKey("banks.id", ondelete="CASCADE"), nullable=False, index=True)
    name: str = Column(String(200), nullable=False, index=True)

    # Operational metrics
    expected_frequency_days: int | None = Column(Integer, nullable=True)
    expected_weekly_revenue: float | None = Column(Float, nullable=True)

    # Address
    address: str | None = Column(String(500), nullable=True)
    city: str | None = Column(String(100), nullable=True)
    district: str | None = Column(String(100), nullable=True)

    # Contact person
    contact_name: str | None = Column(String(200), nullable=True)
    contact_role: str | None = Column(String(100), nullable=True)
    phone: str | None = Column(String(50), nullable=True)
    email: str | None = Column(String(250), nullable=True)
    whatsapp: str | None = Column(String(50), nullable=True)

    notes: str | None = Column(String(500), nullable=True)
    is_active: bool = Column(Boolean, nullable=False, default=True)

    created_at: datetime = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: datetime = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    bank = relationship("Bank", back_populates="branches")


class Client(Base):
    __tablename__ = "clients"

    id: int = Column(Integer, primary_key=True, index=True)
    name: str = Column(String(200), nullable=False, unique=True, index=True)
    phone: str | None = Column(String(50), nullable=True)
    email: str | None = Column(String(250), nullable=True)
    created_at: datetime = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: datetime = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class PropertyType(Base):
    __tablename__ = "property_types"

    id: int = Column(Integer, primary_key=True, index=True)
    name: str = Column(String(200), nullable=False, unique=True, index=True)
    created_at: datetime = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: datetime = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)