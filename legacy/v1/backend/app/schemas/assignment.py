from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from pydantic import Field, model_validator

from app.models.enums import AssignmentStatus, CaseType, ServiceLine
from app.schemas.base import ORMModel


class AssignmentFloorBase(ORMModel):
    floor_name: str = Field(..., min_length=1, max_length=100)
    area: Decimal = Field(..., gt=0)
    order_index: int = 0


class AssignmentFloorCreate(AssignmentFloorBase):
    pass


class AssignmentFloorUpdate(ORMModel):
    floor_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    area: Optional[Decimal] = Field(default=None, gt=0)
    order_index: Optional[int] = None


class AssignmentFloorRead(AssignmentFloorBase):
    id: int
    assignment_id: int
    created_at: datetime
    updated_at: datetime


class AssignmentLandSurveyBase(ORMModel):
    survey_no: str = Field(..., min_length=1, max_length=120)
    acre: Decimal = Decimal("0")
    gunta: Decimal = Decimal("0")
    aana: Decimal = Decimal("0")
    kharab_acre: Decimal = Decimal("0")
    kharab_gunta: Decimal = Decimal("0")
    kharab_aana: Decimal = Decimal("0")


class AssignmentLandSurveyCreate(AssignmentLandSurveyBase):
    serial_no: Optional[int] = None


class AssignmentLandSurveyRead(AssignmentLandSurveyBase):
    id: int
    assignment_id: int
    serial_no: int
    created_at: datetime
    updated_at: datetime


class AssignmentBase(ORMModel):
    case_type: CaseType
    service_line: ServiceLine = ServiceLine.VALUATION
    service_line_id: Optional[int] = None
    service_line_other_text: Optional[str] = None
    uom: Optional[str] = None
    land_policy_override_json: Optional[Dict[str, Any]] = None

    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    client_id: Optional[int] = None
    property_type_id: Optional[int] = None
    property_subtype_id: Optional[int] = None

    bank_name: Optional[str] = None
    branch_name: Optional[str] = None
    valuer_client_name: Optional[str] = None
    property_type: Optional[str] = None

    borrower_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None

    land_area: Optional[Decimal] = None
    builtup_area: Optional[Decimal] = None

    status: AssignmentStatus = AssignmentStatus.PENDING

    assigned_to_user_id: Optional[int] = None
    assignee_user_ids: List[int] = Field(default_factory=list)

    site_visit_date: Optional[datetime] = None
    report_due_date: Optional[datetime] = None

    fees: Optional[Decimal] = None
    is_paid: bool = False

    notes: Optional[str] = None
    floors: List[AssignmentFloorCreate] = Field(default_factory=list)
    land_surveys: List[AssignmentLandSurveyCreate] = Field(default_factory=list)
    payment_timing: Optional[str] = None
    payment_completeness: Optional[str] = None
    preferred_payment_mode: Optional[str] = None


class AssignmentCreate(AssignmentBase):
    override_on_leave: bool = False

    @model_validator(mode="after")
    def validate_case_requirements(self) -> "AssignmentCreate":
        if self.case_type == CaseType.BANK:
            if not self.bank_id or not self.branch_id:
                raise ValueError("BANK assignments require bank_id and branch_id")
        else:
            if not self.client_id and not self.valuer_client_name:
                raise ValueError("Non-bank assignments require client_id or valuer_client_name")
        if self.property_subtype_id and not self.property_type_id:
            raise ValueError("property_subtype_id requires property_type_id")
        if not self.uom or not str(self.uom).strip():
            raise ValueError("uom is required")
        return self


class AssignmentUpdate(ORMModel):
    case_type: Optional[CaseType] = None
    service_line: Optional[ServiceLine] = None
    service_line_id: Optional[int] = None
    service_line_other_text: Optional[str] = None
    uom: Optional[str] = None
    land_policy_override_json: Optional[Dict[str, Any]] = None

    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    client_id: Optional[int] = None
    property_type_id: Optional[int] = None
    property_subtype_id: Optional[int] = None

    bank_name: Optional[str] = None
    branch_name: Optional[str] = None
    valuer_client_name: Optional[str] = None
    property_type: Optional[str] = None

    borrower_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None

    land_area: Optional[Decimal] = None
    builtup_area: Optional[Decimal] = None

    status: Optional[AssignmentStatus] = None

    assigned_to_user_id: Optional[int] = None
    assignee_user_ids: Optional[List[int]] = None

    assigned_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    report_submitted_at: Optional[datetime] = None

    site_visit_date: Optional[datetime] = None
    report_due_date: Optional[datetime] = None

    fees: Optional[Decimal] = None
    is_paid: Optional[bool] = None

    notes: Optional[str] = None
    floors: Optional[List[AssignmentFloorCreate]] = None
    land_surveys: Optional[List[AssignmentLandSurveyCreate]] = None
    payment_timing: Optional[str] = None
    payment_completeness: Optional[str] = None
    preferred_payment_mode: Optional[str] = None
    override_on_leave: Optional[bool] = None


class MissingDocsReminderRequest(ORMModel):
    message: Optional[str] = None
    create_task: bool = True
    assigned_to_user_id: Optional[int] = None
    due_at: Optional[datetime] = None


class AssignmentRead(AssignmentBase):
    id: int
    assignment_code: str
    service_line_name: Optional[str] = None
    effective_land_policy: Optional[Dict[str, Any]] = None
    land_survey_totals: Optional[Dict[str, Any]] = None

    created_by_user_id: int
    assigned_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    report_submitted_at: Optional[datetime] = None

    created_at: datetime
    updated_at: datetime

    is_deleted: bool = False

    property_subtype_name: Optional[str] = None
    assignee_user_ids: List[int] = Field(default_factory=list)
    additional_assignee_user_ids: List[int] = Field(default_factory=list)
    floors: List[AssignmentFloorRead] = Field(default_factory=list)
    land_surveys: List[AssignmentLandSurveyRead] = Field(default_factory=list)


class DueInfo(ORMModel):
    due_time: Optional[datetime]
    due_state: str
    minutes_left: Optional[int] = None
    minutes_overdue: Optional[int] = None
    escalation_role: Optional[str] = None
    escalation_reason: Optional[str] = None


class AssignmentWithDue(AssignmentRead, DueInfo):
    missing_documents_count: int = 0


class AssignmentDetail(ORMModel):
    assignment: AssignmentRead
    due: DueInfo
    documents: List[dict]
    tasks: List[dict]
    messages: List[dict]
    approvals: List[dict]
    invoices: List[dict]
    timeline: List[dict]
    missing_documents: List[str] = Field(default_factory=list)


class AssignmentSummary(ORMModel):
    total: int
    pending: int
    completed: int
    unpaid: int
    overdue: int


class WorkloadBucket(ORMModel):
    due_state: str
    count: int


class UserWorkload(ORMModel):
    user_id: Optional[int]
    user_email: Optional[str]
    user_name: Optional[str]
    on_leave_today: bool
    total_open: int
    overdue: int
    due_soon: int
    ok: int
    buckets: List[WorkloadBucket]


class AllocationSignals(ORMModel):
    open_assignments: int = 0
    overdue_tasks: int = 0
    due_soon: int = 0
    last_active_minutes: Optional[int] = None


class AllocationCandidate(ORMModel):
    user_id: int
    name: str
    roles: List[str] = Field(default_factory=list)
    eligible: bool = False
    reason: Optional[str] = None
    score: int = 0
    overloaded: bool = False
    signals: AllocationSignals


class AllocationAssignBestResponse(ORMModel):
    assignment: AssignmentRead
    candidate: AllocationCandidate
