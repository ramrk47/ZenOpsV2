"""
Payroll management endpoints

Core flows:
  1. Salary Structure CRUD (Finance/Admin)
  2. Payroll Run lifecycle: Draft → Time Pending → Ready → Calculated → Approved → Paid → Locked
  3. Payroll Line Items with calculation
  4. Payslip generation
  5. Exports (bank transfer, payroll register, statutory)
"""

from datetime import datetime, date
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import desc, and_
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.core.deps import get_current_user
from app.core.rbac import require_roles
from app.models.user import User
from app.models.salary_structure import SalaryStructure
from app.models.payroll_run import PayrollRun
from app.models.payroll_line_item import PayrollLineItem
from app.models.payslip import Payslip
from app.models.payroll_policy import PayrollPolicy
from app.models.enums import PayrollRunStatus, Role
from app.schemas.payroll import (
    SalaryStructureCreate,
    SalaryStructureUpdate,
    SalaryStructureResponse,
    PayrollRunCreate,
    PayrollRunResponse,
    PayrollRunDetailResponse,
    PayrollLineItemResponse,
    PayrollCalculateRequest,
    PayslipResponse,
    PayrollPolicyCreate,
    PayrollPolicyUpdate,
    PayrollPolicyResponse,
)
from app.services.payroll_calculation import (
    calculate_hybrid_payroll,
    get_active_salary_structure,
    calculate_attendance_from_work_sessions,
)

router = APIRouter(prefix="/api/payroll", tags=["payroll"])


# ============ SALARY STRUCTURE ENDPOINTS ============

@router.post("/salary-structures", response_model=SalaryStructureResponse)
def create_salary_structure(
    payload: SalaryStructureCreate,
    session: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new salary structure for an employee (Finance/Admin only)"""
    require_roles(current_user, [Role.FINANCE, Role.ADMIN])
    
    # Check if user exists
    employee = session.query(User).filter(User.id == payload.user_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    
    # Ensure effective_from is provided
    if not payload.effective_from:
        raise HTTPException(status_code=400, detail="effective_from is required")
    
    ss = SalaryStructure(
        user_id=payload.user_id,
        effective_from=payload.effective_from,
        effective_to=payload.effective_to,
        monthly_ctc=payload.monthly_ctc,
        monthly_gross=payload.monthly_gross,
        currency=payload.currency or "INR",
        earnings=payload.earnings or {},
        pf_enabled=payload.pf_enabled,
        pf_employee_rate=payload.pf_employee_rate,
        pf_employer_rate=payload.pf_employer_rate,
        esi_enabled=payload.esi_enabled,
        esi_employee_rate=payload.esi_employee_rate,
        esi_employer_rate=payload.esi_employer_rate,
        pt_enabled=payload.pt_enabled,
        pt_monthly_amount=payload.pt_monthly_amount,
        tds_mode=payload.tds_mode or "MANUAL",
        tds_monthly_amount=payload.tds_monthly_amount,
        bank_account_number=payload.bank_account_number,
        bank_ifsc=payload.bank_ifsc,
        bank_beneficiary_name=payload.bank_beneficiary_name,
        standard_minutes_per_day=payload.standard_minutes_per_day or 480,
        payroll_divisor_days=payload.payroll_divisor_days or 30,
        overtime_multiplier=payload.overtime_multiplier or 2.0,
        overtime_requires_approval=payload.overtime_requires_approval if payload.overtime_requires_approval is not None else True,
        is_active=True,
    )
    session.add(ss)
    session.commit()
    session.refresh(ss)
    return ss


@router.get("/salary-structures", response_model=List[SalaryStructureResponse])
def list_salary_structures(
    user_id: Optional[int] = Query(None),
    active_only: bool = Query(True),
    limit: int = Query(100),
    offset: int = Query(0),
    session: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List salary structures with optional filtering (exclude partners)"""
    require_roles(current_user, [Role.FINANCE, Role.ADMIN, Role.HR])

    query = session.query(SalaryStructure).join(User).filter(
        User.is_active == True,
        User.role != Role.EXTERNAL_PARTNER
    )

    if user_id:
        query = query.filter(SalaryStructure.user_id == user_id)

    if active_only:
        query = query.filter(SalaryStructure.is_active == True)

    structures = query.order_by(desc(SalaryStructure.effective_from)).limit(limit).offset(offset).all()
    return structures


@router.get("/salary-structures/{user_id}", response_model=List[SalaryStructureResponse])
def get_user_salary_structures(
    user_id: int,
    session: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all salary structures for an employee (active + historical)"""
    require_roles(current_user, [Role.FINANCE, Role.ADMIN, Role.HR])
    
    structures = session.query(SalaryStructure).filter(
        SalaryStructure.user_id == user_id
    ).order_by(desc(SalaryStructure.effective_from)).all()
    
    return structures


@router.get("/salary-structures/{user_id}/active", response_model=Optional[SalaryStructureResponse])
def get_active_salary_structure_endpoint(
    user_id: int,
    as_of: Optional[date] = Query(None),
    session: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the active salary structure for an employee (as of a specific date if provided)"""
    require_roles(current_user, [Role.FINANCE, Role.ADMIN, Role.HR])
    
    if as_of:
        as_of_dt = datetime.combine(as_of, datetime.min.time())
    else:
        as_of_dt = datetime.now()
    
    structure = get_active_salary_structure(session, user_id, as_of)
    return structure


@router.put("/salary-structures/{structure_id}", response_model=SalaryStructureResponse)
def update_salary_structure(
    structure_id: int,
    payload: SalaryStructureUpdate,
    session: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a salary structure (Finance/Admin only)"""
    require_roles(current_user, [Role.FINANCE, Role.ADMIN])
    
    ss = session.query(SalaryStructure).filter(SalaryStructure.id == structure_id).first()
    if not ss:
        raise HTTPException(status_code=404, detail="Salary structure not found")
    
    # Update fields
    if payload.effective_to is not None:
        ss.effective_to = payload.effective_to
    if payload.monthly_gross is not None:
        ss.monthly_gross = payload.monthly_gross
    if payload.monthly_ctc is not None:
        ss.monthly_ctc = payload.monthly_ctc
    if payload.earnings is not None:
        ss.earnings = payload.earnings
    if payload.pf_enabled is not None:
        ss.pf_enabled = payload.pf_enabled
    if payload.pf_employee_rate is not None:
        ss.pf_employee_rate = payload.pf_employee_rate
    if payload.esi_enabled is not None:
        ss.esi_enabled = payload.esi_enabled
    if payload.pt_enabled is not None:
        ss.pt_enabled = payload.pt_enabled
    if payload.pt_monthly_amount is not None:
        ss.pt_monthly_amount = payload.pt_monthly_amount
    if payload.tds_monthly_amount is not None:
        ss.tds_monthly_amount = payload.tds_monthly_amount
    if payload.standard_minutes_per_day is not None:
        ss.standard_minutes_per_day = payload.standard_minutes_per_day
    if payload.payroll_divisor_days is not None:
        ss.payroll_divisor_days = payload.payroll_divisor_days
    if payload.overtime_multiplier is not None:
        ss.overtime_multiplier = payload.overtime_multiplier
    if payload.overtime_requires_approval is not None:
        ss.overtime_requires_approval = payload.overtime_requires_approval
    if payload.bank_account_number is not None:
        ss.bank_account_number = payload.bank_account_number
    if payload.bank_ifsc is not None:
        ss.bank_ifsc = payload.bank_ifsc
    if payload.bank_beneficiary_name is not None:
        ss.bank_beneficiary_name = payload.bank_beneficiary_name
    if payload.is_active is not None:
        ss.is_active = payload.is_active
    
    session.commit()
    session.refresh(ss)
    return ss


@router.patch("/salary-structures/{structure_id}", response_model=SalaryStructureResponse)
def patch_salary_structure(
    structure_id: int,
    payload: SalaryStructureUpdate,
    session: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a salary structure using PATCH method (Finance/Admin only)"""
    # Reuse the PUT logic
    return update_salary_structure(structure_id, payload, session, current_user)


# ============ PAYROLL RUN ENDPOINTS ============

@router.post("/runs", response_model=PayrollRunResponse)
def create_payroll_run(
    payload: PayrollRunCreate,
    session: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new payroll run (Finance/Admin only)"""
    require_roles(current_user, [Role.FINANCE, Role.ADMIN])
    
    # Check if run already exists for month
    existing = session.query(PayrollRun).filter(
        PayrollRun.month == payload.month
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Payroll run for {payload.month} already exists")
    
    # Parse month (YYYY-MM format)
    try:
        year, month_num = map(int, payload.month.split("-"))
    except ValueError:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM format")
    
    pr = PayrollRun(
        month=payload.month,
        year=year,
        month_num=month_num,
        status=PayrollRunStatus.DRAFT,
        created_by=current_user.id,
        config_snapshot=payload.config_snapshot or {},
        notes=payload.notes,
    )
    session.add(pr)
    session.commit()
    session.refresh(pr)
    return pr


@router.get("/runs", response_model=List[PayrollRunResponse])
def list_payroll_runs(
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
    session: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List payroll runs (Finance/Admin only)"""
    require_roles(current_user, [Role.FINANCE, Role.ADMIN])
    
    runs = session.query(PayrollRun).order_by(desc(PayrollRun.month)).offset(skip).limit(limit).all()
    return runs


@router.get("/runs/{payroll_run_id}", response_model=PayrollRunDetailResponse)
def get_payroll_run_detail(
    payroll_run_id: int,
    session: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get detailed payroll run (Finance/Admin only)"""
    require_roles(current_user, [Role.FINANCE, Role.ADMIN])
    
    pr = session.query(PayrollRun).filter(PayrollRun.id == payroll_run_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Payroll run not found")
    
    return pr


@router.post("/runs/{payroll_run_id}/calculate")
def calculate_payroll_run(
    payroll_run_id: int,
    payload: PayrollCalculateRequest,
    session: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Calculate all payroll line items for a run.
    Moves from DRAFT/TIME_PENDING → CALCULATED.
    """
    require_roles(current_user, [Role.FINANCE, Role.ADMIN])
    
    pr = session.query(PayrollRun).filter(PayrollRun.id == payroll_run_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Payroll run not found")
    
    if pr.status not in [PayrollRunStatus.DRAFT, PayrollRunStatus.TIME_PENDING]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot calculate payroll in {pr.status} status"
        )
    
    # TODO: Validate attendance exceptions are resolved (or overridden)
    # For now, proceed with calculation
    
    # Get all active employees (exclude partners)
    employees = session.query(User).filter(
        User.is_active == True,
        User.role != Role.EXTERNAL_PARTNER
    ).all()
    
    total_gross = 0.0
    total_deductions = 0.0
    total_net = 0.0
    line_count = 0
    exception_count = 0
    
    for emp in employees:
        # Get active salary structure for this payroll month
        salary_struct = get_active_salary_structure(session, emp.id)
        if not salary_struct:
            # Skip employees without active salary structure
            continue
        
        # Fetch attendance data from work sessions
        year, month = int(pr.month.split('-')[0]), int(pr.month.split('-')[1])
        attendance_data = calculate_attendance_from_work_sessions(
            session=session,
            user_id=emp.id,
            year=year,
            month=month,
            attendance_threshold_minutes=120,  # 2 hours minimum to count as present
            standard_minutes_per_day=salary_struct.standard_minutes_per_day or 480,
        )
        
        days_payable = float(attendance_data["days_payable"])
        days_lop = float(attendance_data["days_lop"])
        total_minutes_worked = days_payable * (salary_struct.standard_minutes_per_day or 480) + attendance_data["total_overtime_minutes"]
        
        # Flag if there are exceptions (e.g., missed punches)
        if attendance_data["exceptions"]:
            exception_count += len(attendance_data["exceptions"])
        
        try:
            calc_result = calculate_hybrid_payroll(
                session=session,
                payroll_run=pr,
                user=emp,
                salary_structure=salary_struct,
                days_payable=days_payable,
                days_lop=days_lop,
                total_minutes_worked=total_minutes_worked,
                approval_context={"overtime_approved": False},
            )
            
            # Create or update payroll line item
            line = session.query(PayrollLineItem).filter(
                and_(
                    PayrollLineItem.payroll_run_id == payroll_run_id,
                    PayrollLineItem.user_id == emp.id,
                )
            ).first()
            
            if not line:
                line = PayrollLineItem(
                    payroll_run_id=payroll_run_id,
                    user_id=emp.id,
                    salary_structure_id=salary_struct.id,
                )
                session.add(line)
            
            # Update line with calculation
            line.days_payable = days_payable
            line.days_lop = days_lop
            line.total_minutes_worked = total_minutes_worked
            line.base_monthly_salary = calc_result["base_pay"]
            line.daily_rate = calc_result["daily_rate"]
            line.base_pay = calc_result["base_pay"]
            line.overtime_pay = calc_result["overtime_pay"]
            line.overtime_approved = calc_result["overtime_approved"]
            line.overtime_minutes = calc_result["overtime_minutes"]
            line.gross_pay = calc_result["gross_pay"]
            line.pf_employee = calc_result["pf_employee"]
            line.pf_employer = calc_result["pf_employer"]
            line.esi_employee = calc_result["esi_employee"]
            line.esi_employer = calc_result["esi_employer"]
            line.pt = calc_result["pt"]
            line.tds = calc_result["tds"]
            line.other_deductions = calc_result["other_deductions"]
            line.deductions_total = calc_result["deductions_total"]
            line.net_pay = calc_result["net_pay"]
            line.breakdown_json = calc_result["breakdown_json"]
            
            total_gross += calc_result["gross_pay"]
            total_deductions += calc_result["deductions_total"]
            total_net += calc_result["net_pay"]
            line_count += 1
            
        except Exception as e:
            exception_count += 1
            # Log exception but continue
            print(f"Error calculating payroll for user {emp.id}: {str(e)}")
    
    # Update payroll run
    pr.status = PayrollRunStatus.CALCULATED
    pr.calculated_by = current_user.id
    pr.calculated_at = datetime.now()
    pr.employee_count = line_count
    pr.total_gross = total_gross
    pr.total_deductions = total_deductions
    pr.total_net = total_net
    pr.exception_count = exception_count
    
    session.commit()
    session.refresh(pr)
    
    return {
        "status": "success",
        "payroll_run_id": pr.id,
        "month": pr.month,
        "employees_processed": line_count,
        "exceptions": exception_count,
        "total_gross": total_gross,
        "total_net": total_net,
    }


@router.post("/runs/{payroll_run_id}/approve")
def approve_payroll_run(
    payroll_run_id: int,
    session: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Approve a calculated payroll run (Finance/Admin only)"""
    require_roles(current_user, [Role.FINANCE, Role.ADMIN])
    
    pr = session.query(PayrollRun).filter(PayrollRun.id == payroll_run_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Payroll run not found")
    
    if pr.status != PayrollRunStatus.CALCULATED:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot approve payroll in {pr.status} status"
        )
    
    pr.status = PayrollRunStatus.APPROVED
    pr.approved_by = current_user.id
    pr.approved_at = datetime.now()
    
    session.commit()
    session.refresh(pr)
    
    return {
        "status": "success",
        "payroll_run_id": pr.id,
        "approved_by": current_user.id,
        "approved_at": pr.approved_at,
    }


@router.post("/runs/{payroll_run_id}/mark-paid")
def mark_payroll_paid(
    payroll_run_id: int,
    session: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark payroll as paid (Finance/Admin only)"""
    require_roles(current_user, [Role.FINANCE, Role.ADMIN])
    
    pr = session.query(PayrollRun).filter(PayrollRun.id == payroll_run_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Payroll run not found")
    
    if pr.status != PayrollRunStatus.APPROVED:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot mark as paid; payroll is {pr.status}"
        )
    
    pr.status = PayrollRunStatus.PAID
    pr.paid_by = current_user.id
    pr.paid_at = datetime.now()
    
    session.commit()
    session.refresh(pr)
    
    return {
        "status": "success",
        "payroll_run_id": pr.id,
        "paid_at": pr.paid_at,
    }


@router.post("/runs/{payroll_run_id}/lock")
def lock_payroll_run(
    payroll_run_id: int,
    session: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lock payroll (immutable for audit; Finance/Admin only)"""
    require_roles(current_user, [Role.FINANCE, Role.ADMIN])
    
    pr = session.query(PayrollRun).filter(PayrollRun.id == payroll_run_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="Payroll run not found")
    
    if pr.status != PayrollRunStatus.PAID:
        raise HTTPException(
            status_code=400,
            detail=f"Can only lock paid payroll; current status {pr.status}"
        )
    
    pr.status = PayrollRunStatus.LOCKED
    pr.locked_by = current_user.id
    pr.locked_at = datetime.now()
    
    session.commit()
    session.refresh(pr)
    
    return {
        "status": "success",
        "payroll_run_id": pr.id,
        "locked_at": pr.locked_at,
    }


@router.get("/runs/{payroll_run_id}/line-items", response_model=List[PayrollLineItemResponse])
def get_payroll_line_items(
    payroll_run_id: int,
    session: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all line items for a payroll run (Finance/Admin only)"""
    require_roles(current_user, [Role.FINANCE, Role.ADMIN])
    
    items = session.query(PayrollLineItem).filter(
        PayrollLineItem.payroll_run_id == payroll_run_id
    ).all()
    
    return items



# ============ PAYROLL STATS ENDPOINT ============

@router.get("/stats")
def get_payroll_stats(
    session: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get payroll statistics (Finance/Admin only)"""
    require_roles(current_user, [Role.FINANCE, Role.ADMIN])
    
    # Count active salary structures
    active_structures_count = session.query(SalaryStructure).filter(
        SalaryStructure.is_active == True
    ).count()
    
    # Count total employees with salary structures
    total_employees = session.query(SalaryStructure.user_id).distinct().count()
    
    # Count payroll runs by status
    runs_by_status = {}
    for status in PayrollRunStatus:
        count = session.query(PayrollRun).filter(PayrollRun.status == status).count()
        runs_by_status[status.value] = count
    
    # Get most recent payroll run
    recent_run = session.query(PayrollRun).order_by(desc(PayrollRun.month)).first()
    
    return {
        "active_salary_structures": active_structures_count,
        "total_employees_with_salary": total_employees,
        "runs_by_status": runs_by_status,
        "most_recent_run": {
            "id": recent_run.id,
            "month": recent_run.month,
            "status": recent_run.status.value,
            "employee_count": recent_run.employee_count,
            "total_gross": float(recent_run.total_gross or 0),
            "total_net": float(recent_run.total_net or 0),
        } if recent_run else None,
    }


# ============ PAYROLL POLICY ENDPOINTS ============

@router.get("/policy", response_model=PayrollPolicyResponse)
def get_payroll_policy(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get current (active) payroll policy for company.
    All roles can view.
    """
    policy = db.query(PayrollPolicy).filter(PayrollPolicy.is_active == True).first()
    if not policy:
        # Return default if none exists
        default_policy = PayrollPolicy(
            policy_name="Default Payroll Policy",
            is_active=True,
        )
        db.add(default_policy)
        db.commit()
        db.refresh(default_policy)
        return default_policy
    return policy


@router.patch("/policy", response_model=PayrollPolicyResponse)
def update_payroll_policy(
    payload: PayrollPolicyUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Update payroll policy (Finance/Admin only).
    Creates default if none exists.
    """
    require_roles(current_user, [Role.FINANCE, Role.ADMIN])
    
    policy = db.query(PayrollPolicy).filter(PayrollPolicy.is_active == True).first()
    if not policy:
        policy = PayrollPolicy(policy_name="Default Payroll Policy", is_active=True)
        db.add(policy)
    
    # Update only provided fields
    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if hasattr(policy, key):
            setattr(policy, key, value)
    
    db.commit()
    db.refresh(policy)
    return policy


# ============ PAYSLIP ENDPOINTS ============

@router.get("/payslips", response_model=List[PayslipResponse])
def list_payslips(
    payroll_run_id: Optional[int] = Query(None),
    user_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List payslips with optional filters (Finance/Admin only for all, users see own)."""
    query = db.query(Payslip)
    
    # Non-admin users can only see their own payslips
    if current_user.role not in [Role.ADMIN, Role.FINANCE]:
        query = query.filter(Payslip.user_id == current_user.id)
    else:
        if user_id:
            query = query.filter(Payslip.user_id == user_id)
    
    if payroll_run_id:
        query = query.filter(Payslip.payroll_run_id == payroll_run_id)
    
    return query.order_by(desc(Payslip.generated_at)).all()


@router.get("/payslips/my", response_model=List[PayslipResponse])
def get_my_payslips(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get current user's payslips."""
    payslips = db.query(Payslip).filter(Payslip.user_id == current_user.id).order_by(desc(Payslip.generated_at)).all()
    return payslips


@router.get("/payslips/{payslip_id}", response_model=PayslipResponse)
def get_payslip(
    payslip_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific payslip."""
    payslip = db.query(Payslip).filter(Payslip.id == payslip_id).first()
    if not payslip:
        raise HTTPException(status_code=404, detail="Payslip not found")
    
    # Check authorization: own payslip or admin/finance
    if payslip.user_id != current_user.id:
        require_roles(current_user, [Role.FINANCE, Role.ADMIN])
    
    return payslip


@router.post("/payslips/{payslip_id}/generate")
def generate_payslip(
    payslip_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate/regenerate payslip PDF. TODO: Implement PDF generation."""
    require_roles(current_user, [Role.FINANCE, Role.ADMIN])
    
    payslip = db.query(Payslip).filter(Payslip.id == payslip_id).first()
    if not payslip:
        raise HTTPException(status_code=404, detail="Payslip not found")
    
    # TODO: Implement PDF generation
    raise HTTPException(status_code=501, detail="PDF generation not yet implemented")


@router.get("/payslips/{payslip_id}/download")
def download_payslip(
    payslip_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download payslip PDF. TODO: Implement PDF download."""
    payslip = db.query(Payslip).filter(Payslip.id == payslip_id).first()
    if not payslip:
        raise HTTPException(status_code=404, detail="Payslip not found")
    
    # Check authorization: own payslip or admin/finance
    if payslip.user_id != current_user.id:
        require_roles(current_user, [Role.FINANCE, Role.ADMIN])
    
    # TODO: Implement PDF download
    raise HTTPException(status_code=501, detail="PDF download not yet implemented")


@router.post("/payslips/{payslip_id}/send-email")
def send_payslip_email(
    payslip_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Email payslip to employee. TODO: Implement email sending."""
    require_roles(current_user, [Role.FINANCE, Role.ADMIN])
    
    payslip = db.query(Payslip).filter(Payslip.id == payslip_id).first()
    if not payslip:
        raise HTTPException(status_code=404, detail="Payslip not found")
    
    # TODO: Implement email sending
    raise HTTPException(status_code=501, detail="Email sending not yet implemented")


# ============ PAYROLL RUN ADDITIONAL ENDPOINTS ============

@router.post("/runs/{payroll_run_id}/close")
def close_payroll_run(
    payroll_run_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Close a payroll run (same as lock). Alias for lock endpoint."""
    require_roles(current_user, [Role.FINANCE, Role.ADMIN])
    
    run = db.query(PayrollRun).filter(PayrollRun.id == payroll_run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Payroll run not found")
    
    if run.status != PayrollRunStatus.PAID:
        raise HTTPException(status_code=400, detail="Can only close paid payroll runs")
    
    run.status = PayrollRunStatus.LOCKED
    db.commit()
    db.refresh(run)
    return {"message": "Payroll run closed", "status": run.status.value}


@router.post("/runs/{payroll_run_id}/send-approval")
def send_payroll_approval_request(
    payroll_run_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Send payroll run for approval. TODO: Implement approval workflow."""
    require_roles(current_user, [Role.FINANCE, Role.ADMIN])
    
    run = db.query(PayrollRun).filter(PayrollRun.id == payroll_run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Payroll run not found")
    
    # TODO: Implement approval request workflow
    raise HTTPException(status_code=501, detail="Approval workflow not yet implemented")


@router.get("/runs/{payroll_run_id}/export/{export_type}")
def export_payroll_run(
    payroll_run_id: int,
    export_type: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export payroll run data. TODO: Implement export functionality."""
    require_roles(current_user, [Role.FINANCE, Role.ADMIN])
    
    run = db.query(PayrollRun).filter(PayrollRun.id == payroll_run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Payroll run not found")
    
    valid_types = ["bank-transfer", "payroll-register", "statutory", "csv", "pdf"]
    if export_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"Invalid export type. Valid: {valid_types}")
    
    # TODO: Implement export
    raise HTTPException(status_code=501, detail=f"Export type '{export_type}' not yet implemented")
