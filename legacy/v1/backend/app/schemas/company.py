"""
Company account schemas.

Used for reading and writing company bank account details used when
issuing invoices.
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class CompanyAccountBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    account_name: str
    account_number: str
    bank_name: str
    branch_name: Optional[str] = None
    ifsc_code: Optional[str] = None


class CompanyAccountCreate(CompanyAccountBase):
    pass


class CompanyAccountUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    account_name: Optional[str] = None
    account_number: Optional[str] = None
    bank_name: Optional[str] = None
    branch_name: Optional[str] = None
    ifsc_code: Optional[str] = None


class CompanyAccountRead(CompanyAccountBase):
    id: int
    created_at: datetime
    updated_at: datetime