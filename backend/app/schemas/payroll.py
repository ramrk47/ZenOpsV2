"""
Payroll request/response schemas
"""

from datetime import date, datetime
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field


# ============ SALARY STRUCTURE SCHEMAS ============

class SalaryStructureBase(BaseModel):
    user_id: int
    effective_from: date
    effective_to: Optional[date] = None
    monthly_ctc: Optional[float] = None
    monthly_gross: float = Field(..., gt=0, description="Base gross for payroll calculation")
    currency: str = "INR"
    earnings: Optional[Dict[str, float]] = None
    pf_enabled: bool = True
    pf_employee_rate: Optional[float] = None
    pf_employer_rate: Optional[float] = None
    esi_enabled: bool = False
    esi_employee_rate: Optional[float] = None
    esi_employer_rate: Optional[float] = None
    pt_enabled: bool = True
    pt_monthly_amount: Optional[float] = None
    tds_mode: str = "MANUAL"
    tds_monthly_amount: Optional[float] = None
    bank_account_number: Optional[str] = None
    bank_ifsc: Optional[str] = None
    bank_beneficiary_name: Optional[str] = None
    standard_minutes_per_day: int = 480
    payroll_divisor_days: int = 30
    overtime_multiplier: float = 2.0
    overtime_requires_approval: bool = True


class SalaryStructureCreate(SalaryStructureBase):
    pass


class SalaryStructureUpdate(BaseModel):
    effective_to: Optional[date] = None
    monthly_ctc: Optional[float] = None
    monthly_gross: Optional[float] = None
    earnings: Optional[Dict[str, float]] = None
    pf_enabled: Optional[bool] = None
    pf_employee_rate: Optional[float] = None
    pf_employer_rate: Optional[float] = None
    esi_enabled: Optional[bool] = None
    esi_employee_rate: Optional[float] = None
    esi_employer_rate: Optional[float] = None
    pt_enabled: Optional[bool] = None
    pt_monthly_amount: Optional[float] = None
    tds_monthly_amount: Optional[float] = None
    standard_minutes_per_day: Optional[int] = None
    payroll_divisor_days: Optional[int] = None
    overtime_multiplier: Optional[float] = None
    overtime_requires_approval: Optional[bool] = None
    bank_account_number: Optional[str] = None
    bank_ifsc: Optional[str] = None
    bank_beneficiary_name: Optional[str] = None
    is_active: Optional[bool] = None


class SalaryStructureResponse(SalaryStructureBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ============ PAYROLL RUN SCHEMAS ============

class PayrollRunCreate(BaseModel):
    month: str = Field(..., description="YYYY-MM format, e.g., 2024-01")
    notes: Optional[str] = None
    config_snapshot: Optional[Dict[str, Any]] = None


class PayrollRunResponse(BaseModel):
    id: int
    month: str
    year: int
    month_num: int
    status: str
    employee_count: int
    total_gross: float
    total_deductions: float
    total_net: float
    exception_count: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PayrollRunDetailResponse(PayrollRunResponse):
    notes: Optional[str]
    config_snapshot: Dict[str, Any]
    calculated_at: Optional[datetime]
    approved_at: Optional[datetime]
    paid_at: Optional[datetime]
    locked_at: Optional[datetime]
    total_pf_employee: float
    total_pf_employer: float
    total_esi_employee: float
    total_esi_employer: float
    total_pt: float
    total_tds: float


# ============ PAYROLL LINE ITEM SCHEMAS ============

class PayrollLineItemResponse(BaseModel):
    id: int
    payroll_run_id: int
    user_id: int
    salary_structure_id: int
    days_payable: float
    days_lop: float
    days_present: float
    days_absent: float
    days_leave_paid: float
    days_leave_unpaid: float
    total_minutes_worked: int
    overtime_minutes: int
    late_count: int
    late_minutes: int
    base_monthly_salary: float
    daily_rate: float
    base_pay: float
    overtime_pay: float
    overtime_approved: bool
    gross_pay: float
    pf_employee: float
    pf_employer: float
    esi_employee: float
    esi_employer: float
    pt: float
    tds: float
    other_deductions: float
    deductions_total: float
    net_pay: float
    breakdown_json: Dict[str, Any]
    has_exceptions: bool
    exception_details: Optional[str]
    override_applied: bool
    override_reason: Optional[str]
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ============ PAYSLIP SCHEMAS ============

class PayslipResponse(BaseModel):
    id: int
    payroll_run_id: int
    user_id: int
    payslip_number: str
    generated_at: datetime
    email_sent: bool
    email_sent_at: Optional[datetime]
    downloaded_at: Optional[datetime]
    download_count: int

    class Config:
        from_attributes = True


# ============ PAYROLL CALCULATION SCHEMAS ============

class PayrollCalculateRequest(BaseModel):
    """Request to calculate a payroll run"""
    include_pending_exceptions: bool = False


# ============ EXPORT SCHEMAS ============

class BankTransferRecord(BaseModel):
    """Record for bank transfer export (NEFT list)"""
    employee_id: int
    employee_name: str
    bank_account: str
    ifsc: str
    beneficiary_name: str
    amount: float
    reference: str


class PayrollRegisterRecord(BaseModel):
    """Record for payroll register export (audit report)"""
    employee_id: int
    employee_name: str
    days_payable: float
    gross_pay: float
    pf_employee: float
    pt: float
    tds: float
    deductions_total: float
    net_pay: float


class StatutoryTotalsRecord(BaseModel):
    """Record for statutory totals export"""
    category: str
    employee_count: int
    total_amount: float
    month: str


# ============ PAYROLL POLICY SCHEMAS ============

class PayrollPolicyBase(BaseModel):
    """Base PayrollPolicy schema"""
    monthly_pay_days: int = 30
    full_day_minimum_minutes: int = 480
    half_day_threshold_minutes: int = 240
    grace_period_minutes: int = 15
    
    lop_on_absent: bool = True
    lop_on_unapproved_leave: bool = True
    lop_on_late_threshold_count: Optional[int] = None
    
    overtime_enabled: bool = False
    overtime_multiplier: Optional[float] = 1.5
    overtime_requires_approval: bool = True
    
    pf_enabled_default: bool = True
    pf_employee_rate: float = 12.0
    pf_employer_rate: float = 12.0
    pf_wage_ceiling: Optional[float] = 15000.0
    
    esi_enabled_default: bool = False
    esi_employee_rate: float = 0.75
    esi_employer_rate: float = 3.25
    esi_wage_ceiling: Optional[float] = 21000.0
    
    pt_enabled_default: bool = True
    pt_monthly_amount: Optional[float] = 200.0
    
    tds_enabled_default: bool = True
    leave_type_impacts: Optional[dict] = None
    
    # India-style fields
    weekly_off_day: int = 6  # 6 = Sunday
    annual_paid_leave_quota: int = 21
    company_holidays: Optional[List[Dict[str, Any]]] = None  # [{date: YYYY-MM-DD, name, paid}]
    
    policy_name: str = "Default Payroll Policy"
    is_active: bool = True


class PayrollPolicyCreate(PayrollPolicyBase):
    pass


class PayrollPolicyUpdate(BaseModel):
    """Update subset of policy fields"""
    monthly_pay_days: Optional[int] = None
    overtime_enabled: Optional[bool] = None
    overtime_multiplier: Optional[float] = None
    overtime_requires_approval: Optional[bool] = None
    
    weekly_off_day: Optional[int] = None
    annual_paid_leave_quota: Optional[int] = None
    company_holidays: Optional[List[Dict[str, Any]]] = None
    
    policy_name: Optional[str] = None
    is_active: Optional[bool] = None


class PayrollPolicyResponse(PayrollPolicyBase):
    """Full PayrollPolicy response"""
    id: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

