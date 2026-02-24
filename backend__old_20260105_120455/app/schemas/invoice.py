"""
Invoice schemas.

Defines the request and response models for invoices and invoice items.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field

from ..models.invoice import InvoiceStatus


class InvoiceItemCreate(BaseModel):
    description: str
    quantity: int = Field(default=1, ge=1)
    unit_price: float = Field(ge=0)

    class Config:
        from_attributes = True


class InvoiceItemRead(InvoiceItemCreate):
    id: int
    total_price: float

    class Config:
        from_attributes = True


class InvoiceBase(BaseModel):
    assignment_id: int
    total_amount: Optional[float] = None
    tax_amount: Optional[float] = None
    discount_amount: Optional[float] = None
    due_date: Optional[datetime] = None
    notes: Optional[str] = None
    items: List[InvoiceItemCreate] = []

    class Config:
        from_attributes = True


class InvoiceCreate(InvoiceBase):
    pass


class InvoiceUpdate(BaseModel):
    status: Optional[InvoiceStatus] = None
    total_amount: Optional[float] = None
    tax_amount: Optional[float] = None
    discount_amount: Optional[float] = None
    due_date: Optional[datetime] = None
    notes: Optional[str] = None

    class Config:
        from_attributes = True


class InvoiceRead(InvoiceBase):
    id: int
    invoice_number: str
    status: InvoiceStatus
    invoice_date: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    items: List[InvoiceItemRead] = []

    class Config:
        from_attributes = True