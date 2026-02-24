from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import Field

from app.models.enums import CalendarEventType, CaseType
from app.schemas.base import ORMModel


class BankBase(ORMModel):
    name: str = Field(..., min_length=2, max_length=255)
    code: Optional[str] = Field(default=None, max_length=50)
    is_active: bool = True


class BankCreate(BankBase):
    pass


class BankUpdate(ORMModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    code: Optional[str] = Field(default=None, max_length=50)
    is_active: Optional[bool] = None


class BankRead(BankBase):
    id: int
    created_at: datetime
    updated_at: datetime


class BranchBase(ORMModel):
    bank_id: int
    name: str = Field(..., min_length=2, max_length=255)
    code: Optional[str] = Field(default=None, max_length=50)
    city: Optional[str] = Field(default=None, max_length=100)
    state: Optional[str] = Field(default=None, max_length=100)
    is_active: bool = True


class BranchCreate(BranchBase):
    pass


class BranchUpdate(ORMModel):
    bank_id: Optional[int] = None
    name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    code: Optional[str] = Field(default=None, max_length=50)
    city: Optional[str] = Field(default=None, max_length=100)
    state: Optional[str] = Field(default=None, max_length=100)
    is_active: Optional[bool] = None


class BranchRead(BranchBase):
    id: int
    created_at: datetime
    updated_at: datetime


class ClientBase(ORMModel):
    name: str = Field(..., min_length=2, max_length=255)
    client_type: Optional[str] = Field(default=None, max_length=100)
    contact_name: Optional[str] = Field(default=None, max_length=255)
    contact_phone: Optional[str] = Field(default=None, max_length=50)
    contact_email: Optional[str] = Field(default=None, max_length=255)
    is_active: bool = True


class ClientCreate(ClientBase):
    pass


class ClientUpdate(ORMModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    client_type: Optional[str] = Field(default=None, max_length=100)
    contact_name: Optional[str] = Field(default=None, max_length=255)
    contact_phone: Optional[str] = Field(default=None, max_length=50)
    contact_email: Optional[str] = Field(default=None, max_length=255)
    is_active: Optional[bool] = None


class ClientRead(ClientBase):
    id: int
    created_at: datetime
    updated_at: datetime


class PropertyTypeBase(ORMModel):
    name: str = Field(..., min_length=2, max_length=255)
    description: Optional[str] = None
    is_active: bool = True


class PropertyTypeCreate(PropertyTypeBase):
    pass


class PropertyTypeUpdate(ORMModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    description: Optional[str] = None
    is_active: Optional[bool] = None


class PropertyTypeRead(PropertyTypeBase):
    id: int
    created_at: datetime
    updated_at: datetime


class PropertySubtypeBase(ORMModel):
    property_type_id: int
    name: str = Field(..., min_length=2, max_length=255)
    description: Optional[str] = None
    is_active: bool = True


class PropertySubtypeCreate(PropertySubtypeBase):
    pass


class PropertySubtypeUpdate(ORMModel):
    property_type_id: Optional[int] = None
    name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    description: Optional[str] = None
    is_active: Optional[bool] = None


class PropertySubtypeRead(PropertySubtypeBase):
    id: int
    created_at: datetime
    updated_at: datetime


class CompanyAccountBase(ORMModel):
    bank_id: Optional[int] = None
    account_name: str
    account_number: str
    ifsc_code: Optional[str] = None
    bank_name: str
    branch_name: Optional[str] = None
    upi_id: Optional[str] = None
    is_primary: bool = False
    is_active: bool = True
    notes: Optional[str] = None


class CompanyAccountCreate(CompanyAccountBase):
    pass


class CompanyAccountUpdate(ORMModel):
    bank_id: Optional[int] = None
    account_name: Optional[str] = None
    account_number: Optional[str] = None
    ifsc_code: Optional[str] = None
    bank_name: Optional[str] = None
    branch_name: Optional[str] = None
    upi_id: Optional[str] = None
    is_primary: Optional[bool] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class CompanyAccountRead(CompanyAccountBase):
    id: int
    created_at: datetime
    updated_at: datetime


class CompanyProfileBase(ORMModel):
    business_name: str = Field(default="Pinnacle Consultants")
    legal_name: Optional[str] = None
    tagline: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state_name: Optional[str] = None
    state_code: Optional[str] = None
    postal_code: Optional[str] = None
    country: Optional[str] = "India"
    gstin: Optional[str] = None
    pan: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    website: Optional[str] = None
    default_gst_rate: Decimal = Field(default=Decimal("18.00"))
    notes: Optional[str] = None
    is_active: bool = True


class CompanyProfileCreate(CompanyProfileBase):
    pass


class CompanyProfileUpdate(ORMModel):
    business_name: Optional[str] = None
    legal_name: Optional[str] = None
    tagline: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state_name: Optional[str] = None
    state_code: Optional[str] = None
    postal_code: Optional[str] = None
    country: Optional[str] = None
    gstin: Optional[str] = None
    pan: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    website: Optional[str] = None
    default_gst_rate: Optional[Decimal] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class CompanyProfileRead(CompanyProfileBase):
    id: int
    created_at: datetime
    updated_at: datetime


class CalendarEventLabelBase(ORMModel):
    name: str = Field(..., min_length=2, max_length=255)
    description: Optional[str] = None
    default_event_type: CalendarEventType = CalendarEventType.INTERNAL_MEETING
    is_active: bool = True


class CalendarEventLabelCreate(CalendarEventLabelBase):
    pass


class CalendarEventLabelUpdate(ORMModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    description: Optional[str] = None
    default_event_type: Optional[CalendarEventType] = None
    is_active: Optional[bool] = None


class CalendarEventLabelRead(CalendarEventLabelBase):
    id: int
    created_at: datetime
    updated_at: datetime


class DocumentChecklistTemplateBase(ORMModel):
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    property_type_id: Optional[int] = None
    property_subtype_id: Optional[int] = None
    case_type: Optional[CaseType] = None
    category: str
    required: bool = True
    notes: Optional[str] = None


class DocumentChecklistTemplateCreate(DocumentChecklistTemplateBase):
    pass


class DocumentChecklistTemplateUpdate(ORMModel):
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    property_type_id: Optional[int] = None
    property_subtype_id: Optional[int] = None
    case_type: Optional[CaseType] = None
    category: Optional[str] = None
    required: Optional[bool] = None
    notes: Optional[str] = None


class DocumentChecklistTemplateRead(DocumentChecklistTemplateBase):
    id: int
    created_at: datetime
    updated_at: datetime
