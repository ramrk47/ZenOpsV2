"""
Master data schemas.
"""

from __future__ import annotations

from typing import Optional
from pydantic import BaseModel


class BankRead(BaseModel):
    id: int
    name: str
    account_name: Optional[str] = None
    account_number: Optional[str] = None
    ifsc: Optional[str] = None
    account_bank_name: Optional[str] = None
    account_branch_name: Optional[str] = None
    upi_id: Optional[str] = None
    invoice_notes: Optional[str] = None

    class Config:
        from_attributes = True


class BranchRead(BaseModel):
    id: int
    bank_id: int
    name: str
    expected_frequency_days: Optional[int] = None
    expected_weekly_revenue: Optional[float] = None
    address: Optional[str] = None
    city: Optional[str] = None
    district: Optional[str] = None
    contact_name: Optional[str] = None
    contact_role: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    whatsapp: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool

    class Config:
        from_attributes = True


class ClientRead(BaseModel):
    id: int
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None

    class Config:
        from_attributes = True


class PropertyTypeRead(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True