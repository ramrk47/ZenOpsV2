"""
Assignment schemas.

Define Pydantic models for creating, reading and updating assignments.
Some computed fields (due_time, due_state, minutes_left) are exposed on
list/detail responses.
"""

from __future__ import annotations

from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel, Field

from ..models.assignment import AssignmentStatus, CaseType
from ..models.task import TaskStatus
from ..models.invoice import InvoiceStatus


class AssignmentBase(BaseModel):
    assignment_code: str
    case_type: CaseType
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    client_id: Optional[int] = None
    property_type_id: Optional[int] = None
    bank_name: Optional[str] = None
    branch_name: Optional[str] = None
    valuer_client_name: Optional[str] = None
    property_type: Optional[str] = None
    borrower_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    land_area: Optional[float] = None
    builtup_area: Optional[float] = None
    status: AssignmentStatus = AssignmentStatus.PENDING
    assigned_to_user_id: Optional[int] = None
    site_visit_date: Optional[datetime] = None
    report_due_date: Optional[datetime] = None
    fees: Optional[float] = None
    is_paid: Optional[bool] = False
    notes: Optional[str] = None

    class Config:
        from_attributes = True


class AssignmentCreate(AssignmentBase):
    assignment_code: str = Field(min_length=1)
    case_type: CaseType = Field(default=CaseType.BANK)


class AssignmentUpdate(BaseModel):
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    client_id: Optional[int] = None
    property_type_id: Optional[int] = None
    bank_name: Optional[str] = None
    branch_name: Optional[str] = None
    valuer_client_name: Optional[str] = None
    property_type: Optional[str] = None
    borrower_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    land_area: Optional[float] = None
    builtup_area: Optional[float] = None
    status: Optional[AssignmentStatus] = None
    assigned_to_user_id: Optional[int] = None
    site_visit_date: Optional[datetime] = None
    report_due_date: Optional[datetime] = None
    fees: Optional[float] = None
    is_paid: Optional[bool] = None
    notes: Optional[str] = None

    class Config:
        from_attributes = True


class AssignmentListItem(BaseModel):
    id: int
    assignment_code: str
    status: AssignmentStatus
    case_type: CaseType
    assigned_to_user_id: Optional[int]
    due_time: Optional[datetime] = None
    due_state: Optional[str] = None
    minutes_left: Optional[int] = None

    class Config:
        from_attributes = True


class AssignmentRead(AssignmentBase):
    id: int
    created_by_user_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    due_time: Optional[datetime] = None
    due_state: Optional[str] = None
    minutes_left: Optional[int] = None

    class Config:
        from_attributes = True


class TaskNested(BaseModel):
    id: int
    title: str
    status: TaskStatus
    due_at: Optional[datetime] = None
    assignee_name: Optional[str] = None

    class Config:
        from_attributes = True


class InvoiceNested(BaseModel):
    id: int
    invoice_number: str
    status: InvoiceStatus
    total_amount: Optional[float] = None

    class Config:
        from_attributes = True


class DocumentNested(BaseModel):
    id: int
    original_name: str
    category: Optional[str] = None
    version_number: Optional[int] = None
    is_final: bool

    class Config:
        from_attributes = True


class MessageNested(BaseModel):
    id: int
    message: str
    sender_user_id: Optional[int]
    created_at: datetime
    pinned: bool

    class Config:
        from_attributes = True


class AssignmentDetail(AssignmentRead):
    tasks: List[TaskNested] = []
    documents: List[DocumentNested] = []
    messages: List[MessageNested] = []
    invoice: Optional[InvoiceNested] = None