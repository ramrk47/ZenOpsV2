from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import Field

from app.models.enums import InvoiceAdjustmentType, InvoiceStatus, PaymentMode
from app.schemas.base import ORMModel


class InvoiceItemBase(ORMModel):
    description: str = Field(..., min_length=1, max_length=255)
    quantity: Decimal = Field(default=Decimal("1.00"))
    unit_price: Decimal = Field(default=Decimal("0.00"))
    order_index: int = 0
    tax_code: Optional[str] = Field(default=None, max_length=50)
    tax_rate: Optional[Decimal] = None
    service_code: Optional[str] = Field(default=None, max_length=50)


class InvoiceItemCreate(InvoiceItemBase):
    pass


class InvoiceItemUpdate(ORMModel):
    description: Optional[str] = Field(default=None, min_length=1, max_length=255)
    quantity: Optional[Decimal] = None
    unit_price: Optional[Decimal] = None
    order_index: Optional[int] = None
    tax_code: Optional[str] = None
    tax_rate: Optional[Decimal] = None
    service_code: Optional[str] = None


class InvoiceItemRead(InvoiceItemBase):
    id: int
    invoice_id: int
    line_total: Decimal
    created_at: datetime
    updated_at: datetime


class InvoicePaymentCreate(ORMModel):
    amount: Decimal = Field(..., gt=Decimal("0.00"))
    paid_at: Optional[datetime] = None
    mode: PaymentMode = PaymentMode.MANUAL
    reference_no: Optional[str] = Field(default=None, max_length=100)
    notes: Optional[str] = None


class InvoicePaymentRead(ORMModel):
    id: int
    invoice_id: int
    amount: Decimal
    paid_at: datetime
    mode: PaymentMode
    reference_no: Optional[str] = None
    notes: Optional[str] = None
    created_by_user_id: int
    created_at: datetime
    updated_at: datetime


class InvoiceAdjustmentCreate(ORMModel):
    amount: Decimal = Field(..., gt=Decimal("0.00"))
    adjustment_type: InvoiceAdjustmentType = InvoiceAdjustmentType.CREDIT_NOTE
    reason: Optional[str] = None
    issued_at: Optional[datetime] = None


class InvoiceAdjustmentRead(ORMModel):
    id: int
    invoice_id: int
    amount: Decimal
    adjustment_type: InvoiceAdjustmentType
    reason: Optional[str] = None
    issued_at: datetime
    created_by_user_id: int
    created_at: datetime
    updated_at: datetime


class InvoiceTaxBreakdownRead(ORMModel):
    id: int
    invoice_id: int
    taxable_value: Decimal
    cgst: Decimal
    sgst: Decimal
    igst: Decimal
    cess: Decimal
    created_at: datetime


class InvoiceAuditLogRead(ORMModel):
    id: int
    invoice_id: int
    event_type: str
    actor_user_id: Optional[int] = None
    diff_json: Optional[dict] = None
    created_at: datetime


class InvoiceAttachmentRead(ORMModel):
    id: int
    invoice_id: int
    uploaded_by_user_id: int
    original_name: str
    storage_path: str
    mime_type: Optional[str] = None
    size: int
    category: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class InvoiceCreate(ORMModel):
    assignment_id: int
    issued_date: Optional[date] = None
    due_date: Optional[date] = None
    tax_rate: Optional[Decimal] = None
    notes: Optional[str] = None
    company_account_id: Optional[int] = None
    currency: Optional[str] = Field(default="INR", max_length=3)
    bill_to_name: Optional[str] = None
    bill_to_address: Optional[str] = None
    bill_to_gstin: Optional[str] = None
    place_of_supply: Optional[str] = None
    terms: Optional[str] = None
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    client_id: Optional[int] = None
    items: List[InvoiceItemCreate] = Field(default_factory=list)


class InvoiceUpdate(ORMModel):
    issued_date: Optional[date] = None
    due_date: Optional[date] = None
    tax_rate: Optional[Decimal] = None
    notes: Optional[str] = None
    company_account_id: Optional[int] = None
    currency: Optional[str] = Field(default=None, max_length=3)
    bill_to_name: Optional[str] = None
    bill_to_address: Optional[str] = None
    bill_to_gstin: Optional[str] = None
    place_of_supply: Optional[str] = None
    terms: Optional[str] = None
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    client_id: Optional[int] = None
    items: Optional[List[InvoiceItemCreate]] = None


class InvoiceIssuePayload(ORMModel):
    issued_date: Optional[date] = None
    due_date: Optional[date] = None


class InvoiceSendPayload(ORMModel):
    sent_at: Optional[datetime] = None


class InvoiceVoidPayload(ORMModel):
    reason: str = Field(..., min_length=3)


class InvoiceLedgerItemPreview(ORMModel):
    description: str
    quantity: Decimal
    line_total: Decimal


class InvoiceLedgerRow(ORMModel):
    id: int
    assignment_id: int
    assignment_code: Optional[str] = None
    invoice_number: Optional[str] = None
    status: InvoiceStatus
    issued_at: Optional[date] = None
    due_date: Optional[date] = None
    is_overdue: bool
    currency: str
    subtotal: Decimal
    tax_total: Decimal
    grand_total: Decimal
    amount_paid: Decimal
    amount_due: Decimal
    amount_credited: Decimal
    items_count: int = 0
    last_payment_at: Optional[datetime] = None
    last_payment_amount: Optional[Decimal] = None
    item_preview: List[InvoiceLedgerItemPreview] = Field(default_factory=list)
    party_name: Optional[str] = None
    bank_name: Optional[str] = None
    branch_name: Optional[str] = None
    created_at: datetime


class InvoiceListResponse(ORMModel):
    items: List[InvoiceLedgerRow]
    total: int
    page: int
    page_size: int
    has_more: bool
    next_page: Optional[int] = None
    prev_page: Optional[int] = None


class InvoiceRead(ORMModel):
    id: int
    assignment_id: int
    assignment_code: Optional[str] = None
    invoice_number: Optional[str] = None
    status: InvoiceStatus
    issued_date: date
    due_date: Optional[date] = None
    sent_at: Optional[datetime] = None
    currency: str
    subtotal: Decimal
    tax_rate: Decimal
    tax_amount: Decimal
    total_amount: Decimal
    tax_total: Decimal
    grand_total: Decimal
    amount_paid: Decimal
    amount_due: Decimal
    amount_credited: Decimal
    is_paid: bool
    paid_at: Optional[datetime] = None
    bill_to_name: Optional[str] = None
    bill_to_address: Optional[str] = None
    bill_to_gstin: Optional[str] = None
    place_of_supply: Optional[str] = None
    terms: Optional[str] = None
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    client_id: Optional[int] = None
    party_name: Optional[str] = None
    bank_name: Optional[str] = None
    branch_name: Optional[str] = None
    created_by_user_id: int
    company_account_id: Optional[int] = None
    notes: Optional[str] = None
    pdf_generated_at: Optional[datetime] = None
    pdf_generated_by_user_id: Optional[int] = None
    voided_at: Optional[datetime] = None
    void_reason: Optional[str] = None
    voided_by_user_id: Optional[int] = None
    items: List[InvoiceItemRead]
    payments: List[InvoicePaymentRead] = Field(default_factory=list)
    adjustments: List[InvoiceAdjustmentRead] = Field(default_factory=list)
    tax_breakdown: Optional[InvoiceTaxBreakdownRead] = None
    audit_trail: List[InvoiceAuditLogRead] = Field(default_factory=list)
    attachments: List[InvoiceAttachmentRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
