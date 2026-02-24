"""
Company account model.

Stores bank account details used when issuing invoices. A company may
have multiple bank accounts; invoices can reference a specific account.
This allows administrators to update banking details without editing
invoices.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.orm import relationship

from .base import Base


class CompanyAccount(Base):
    __tablename__ = "company_accounts"

    id: int = Column(Integer, primary_key=True)
    account_name: str = Column(String(255), nullable=False)
    account_number: str = Column(String(255), nullable=False)
    bank_name: str = Column(String(255), nullable=False)
    branch_name: str | None = Column(String(255))
    ifsc_code: str | None = Column(String(50))
    created_at: datetime = Column(DateTime, default=datetime.utcnow)
    updated_at: datetime = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    invoices = relationship("Invoice", back_populates="company_account")