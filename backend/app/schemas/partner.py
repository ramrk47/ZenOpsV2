from __future__ import annotations

from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List

from pydantic import Field

from app.models.enums import (
    CommissionRequestStatus,
    PartnerRequestDirection,
    PartnerRequestEntityType,
    PartnerRequestStatus,
    PartnerRequestType,
)
from app.models.enums import ServiceLine
from app.schemas.base import ORMModel


class ExternalPartnerBase(ORMModel):
    display_name: str = Field(..., min_length=1, max_length=255)
    legal_name: Optional[str] = None
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    alternate_contact_name: Optional[str] = None
    alternate_contact_email: Optional[str] = None
    alternate_contact_phone: Optional[str] = None
    city: Optional[str] = None
    billing_address: Optional[str] = None
    billing_city: Optional[str] = None
    billing_state: Optional[str] = None
    billing_postal_code: Optional[str] = None
    gstin: Optional[str] = None
    default_payment_terms_days: Optional[int] = None
    service_lines: Optional[List[ServiceLine]] = None
    multi_floor_enabled: bool = False
    notes: Optional[str] = None
    is_active: bool = True


class ExternalPartnerCreate(ExternalPartnerBase):
    pass


class ExternalPartnerUpdate(ORMModel):
    display_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    legal_name: Optional[str] = None
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    alternate_contact_name: Optional[str] = None
    alternate_contact_email: Optional[str] = None
    alternate_contact_phone: Optional[str] = None
    city: Optional[str] = None
    billing_address: Optional[str] = None
    billing_city: Optional[str] = None
    billing_state: Optional[str] = None
    billing_postal_code: Optional[str] = None
    gstin: Optional[str] = None
    default_payment_terms_days: Optional[int] = None
    service_lines: Optional[List[ServiceLine]] = None
    multi_floor_enabled: Optional[bool] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class ExternalPartnerRead(ExternalPartnerBase):
    id: int
    created_at: datetime
    updated_at: datetime


class PartnerSummaryRead(ExternalPartnerRead):
    commission_count: int = 0
    converted_count: int = 0
    unpaid_total: Decimal = Decimal("0.00")
    last_activity_at: Optional[datetime] = None


class PartnerBankBreakdown(ORMModel):
    bank_id: Optional[int] = None
    bank_name: Optional[str] = None
    branch_id: Optional[int] = None
    branch_name: Optional[str] = None
    assignment_count: int = 0
    invoice_total: Decimal = Decimal("0.00")
    invoice_paid: Decimal = Decimal("0.00")
    invoice_unpaid: Decimal = Decimal("0.00")


class CommissionRequestBase(ORMModel):
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    client_id: Optional[int] = None
    property_type_id: Optional[int] = None
    property_subtype_id: Optional[int] = None
    service_line: Optional[ServiceLine] = None

    bank_name: Optional[str] = None
    branch_name: Optional[str] = None
    valuer_client_name: Optional[str] = None
    property_type: Optional[str] = None

    borrower_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None

    land_area: Optional[Decimal] = None
    builtup_area: Optional[Decimal] = None

    site_visit_date: Optional[datetime] = None
    report_due_date: Optional[datetime] = None

    notes: Optional[str] = None


class CommissionFloorBase(ORMModel):
    floor_name: str
    area: Decimal
    order_index: Optional[int] = None


class CommissionFloorCreate(CommissionFloorBase):
    pass


class CommissionFloorRead(CommissionFloorBase):
    id: int


class CommissionRequestCreate(CommissionRequestBase):
    floors: Optional[List[CommissionFloorCreate]] = None
    pass


class CommissionRequestUpdate(ORMModel):
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    client_id: Optional[int] = None
    property_type_id: Optional[int] = None
    property_subtype_id: Optional[int] = None
    service_line: Optional[ServiceLine] = None
    bank_name: Optional[str] = None
    branch_name: Optional[str] = None
    valuer_client_name: Optional[str] = None
    property_type: Optional[str] = None
    borrower_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    land_area: Optional[Decimal] = None
    builtup_area: Optional[Decimal] = None
    site_visit_date: Optional[datetime] = None
    report_due_date: Optional[datetime] = None
    notes: Optional[str] = None
    floors: Optional[List[CommissionFloorCreate]] = None
    admin_notes: Optional[str] = None
    decision_reason: Optional[str] = None
    status: Optional[CommissionRequestStatus] = None


class CommissionRequestSummary(ORMModel):
    id: int
    request_code: str
    status: CommissionRequestStatus
    borrower_name: Optional[str] = None
    bank_name: Optional[str] = None
    branch_name: Optional[str] = None
    service_line: Optional[ServiceLine] = None
    updated_at: datetime
    submitted_at: Optional[datetime] = None
    decided_at: Optional[datetime] = None


class CommissionRequestDocumentRead(ORMModel):
    id: int
    commission_request_id: int
    original_name: str
    category: Optional[str] = None
    created_at: datetime


class CommissionRequestRead(CommissionRequestBase):
    id: int
    request_code: str
    partner_id: int
    status: CommissionRequestStatus
    created_by_user_id: int
    submitted_at: Optional[datetime] = None
    decided_at: Optional[datetime] = None
    decision_reason: Optional[str] = None
    converted_assignment_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    documents: List[CommissionRequestDocumentRead] = Field(default_factory=list)
    floors: List[CommissionFloorRead] = Field(default_factory=list)


class CommissionRequestAdminRead(CommissionRequestRead):
    admin_notes: Optional[str] = None


class PartnerRequestBase(ORMModel):
    partner_id: int
    direction: PartnerRequestDirection
    request_type: PartnerRequestType
    entity_type: PartnerRequestEntityType
    entity_id: int
    status: PartnerRequestStatus = PartnerRequestStatus.OPEN
    message: str
    payload_json: Optional[dict] = None


class PartnerRequestCreate(PartnerRequestBase):
    created_by_user_id: Optional[int] = None
    created_by_partner_user_id: Optional[int] = None


class PartnerRequestRead(PartnerRequestBase):
    id: int
    created_by_user_id: Optional[int] = None
    created_by_partner_user_id: Optional[int] = None
    created_at: datetime
    closed_at: Optional[datetime] = None


class PartnerRequestRespondPayload(ORMModel):
    message: str = Field(..., min_length=1)


class PartnerRequestAttachmentRead(ORMModel):
    id: int
    partner_request_id: int
    original_name: str
    category: Optional[str] = None
    created_at: datetime


class CommissionApprovePayload(ORMModel):
    assigned_to_user_id: Optional[int] = None
    service_line: Optional[ServiceLine] = None
    fees: Optional[Decimal] = None
    notes: Optional[str] = None


class CommissionRejectPayload(ORMModel):
    reason: str = Field(..., min_length=1)


class CommissionNeedsInfoPayload(ORMModel):
    message: str = Field(..., min_length=1)
    payload_json: Optional[dict] = None


class PartnerRequestAdminCreate(ORMModel):
    partner_id: int
    request_type: PartnerRequestType
    entity_type: PartnerRequestEntityType
    entity_id: int
    message: str = Field(..., min_length=1)
    payload_json: Optional[dict] = None


class PartnerDeliverableReleasePayload(ORMModel):
    document_id: int


class PartnerAssignmentSummary(ORMModel):
    id: int
    assignment_code: str
    borrower_name: Optional[str] = None
    status: str
    payment_status: Optional[str] = None
    updated_at: datetime


class PartnerAssignmentDetail(ORMModel):
    id: int
    assignment_code: str
    borrower_name: Optional[str] = None
    bank_name: Optional[str] = None
    branch_name: Optional[str] = None
    status: str
    site_visit_date: Optional[datetime] = None
    report_due_date: Optional[datetime] = None
    payment_status: Optional[str] = None


class PartnerInvoiceSummary(ORMModel):
    id: int
    invoice_number: Optional[str] = None
    issued_date: date
    due_date: Optional[date] = None
    status: str
    total_amount: Decimal
    amount_due: Decimal
    is_paid: bool
    paid_at: Optional[datetime] = None


class PartnerInvoiceDetail(PartnerInvoiceSummary):
    subtotal: Decimal
    tax_rate: Decimal
    tax_amount: Decimal
    amount_paid: Decimal
    amount_credited: Decimal
    currency: str
    notes: Optional[str] = None


class PartnerDeliverableRead(ORMModel):
    id: int
    assignment_id: int
    document_id: int
    released_at: Optional[datetime] = None
    original_name: Optional[str] = None
