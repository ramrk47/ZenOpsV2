"""
Hybrid Payroll Calculation Service

Implements fixed monthly salary (pro-rata) + approved overtime minutes.

Formula:
  daily_rate = monthly_gross / payroll_divisor_days
  base_pay = daily_rate * days_payable
  overtime_rate = (daily_rate / (standard_minutes_per_day / 60)) * overtime_multiplier
  overtime_pay = (total_overtime_minutes / 60) * overtime_rate  [if approved]
  gross_pay = base_pay + overtime_pay
  net_pay = gross_pay - deductions_total
"""

from datetime import datetime
from decimal import Decimal
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from app.models.salary_structure import SalaryStructure
from app.models.payroll_line_item import PayrollLineItem
from app.models.payroll_run import PayrollRun
from app.models.user import User


class PayrollCalculationError(Exception):
    """Base exception for payroll calculation errors"""
    pass


def calculate_hybrid_payroll(
    session: Session,
    payroll_run: PayrollRun,
    user: User,
    salary_structure: SalaryStructure,
    days_payable: float,
    days_lop: float,
    total_minutes_worked: int,
    approval_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Calculate payroll using hybrid model for a single employee.
    
    Args:
        session: Database session
        payroll_run: The payroll run period
        user: Employee
        salary_structure: Effective salary structure
        days_payable: Days eligible for payment (present + paid leaves - absences/LOP)
        days_lop: Loss of pay days
        total_minutes_worked: Total minutes worked in period
        approval_context: Optional context with overtime_approved flag
    
    Returns:
        Dict with all payroll components, breakdown, and flags
    """
    
    if not salary_structure:
        raise PayrollCalculationError(f"No active salary structure for user {user.id}")
    
    if salary_structure.monthly_gross <= 0:
        raise PayrollCalculationError(f"Invalid monthly_gross: {salary_structure.monthly_gross}")
    
    # Extract hybrid payroll config
    monthly_gross = float(salary_structure.monthly_gross)
    divisor_days = salary_structure.payroll_divisor_days or 30
    standard_minutes_per_day = salary_structure.standard_minutes_per_day or 480
    overtime_multiplier = float(salary_structure.overtime_multiplier or 2.0)
    ot_requires_approval = salary_structure.overtime_requires_approval
    
    # Default approval context
    if approval_context is None:
        approval_context = {}
    
    overtime_approved = approval_context.get("overtime_approved", False)
    
    # ============ HYBRID PAYROLL CALCULATION ============
    
    # 1. Daily rate = monthly_gross / divisor
    daily_rate = monthly_gross / divisor_days
    
    # 2. Base pay = daily_rate * days_payable (fixed monthly component, pro-rata)
    base_pay = daily_rate * days_payable
    
    # 3. Overtime calculation (minutes-based)
    # Hourly equivalent = daily_rate / (standard_minutes_per_day / 60)
    hourly_rate = daily_rate / (standard_minutes_per_day / 60.0)
    overtime_rate = hourly_rate * overtime_multiplier
    
    # Compute overtime minutes (only if > standard per day)
    # For simplicity, assume all worked minutes beyond standard_minutes_per_day * days_payable is OT
    expected_standard_minutes = standard_minutes_per_day * days_payable
    overtime_minutes = max(0, total_minutes_worked - int(expected_standard_minutes))
    
    # Overtime pay is conditional on approval
    overtime_pay = 0.0
    if ot_requires_approval:
        if overtime_approved:
            overtime_pay = (overtime_minutes / 60.0) * overtime_rate
    else:
        # If approval not required, pay overtime automatically
        overtime_pay = (overtime_minutes / 60.0) * overtime_rate
    
    # 4. Gross pay = base_pay + overtime_pay
    gross_pay = base_pay + overtime_pay
    
    # ============ DEDUCTIONS (placeholder for now) ============
    
    deductions_total = 0.0
    pf_employee = 0.0
    pf_employer = 0.0
    esi_employee = 0.0
    esi_employer = 0.0
    pt = 0.0
    tds = 0.0
    other_deductions = 0.0
    
    # PF calculation (if enabled)
    if salary_structure.pf_enabled and salary_structure.pf_employee_rate:
        pf_rate = float(salary_structure.pf_employee_rate) / 100.0
        pf_employee = base_pay * pf_rate  # PF on base only, not OT
        deductions_total += pf_employee
    
    # PT calculation (if enabled)
    if salary_structure.pt_enabled and salary_structure.pt_monthly_amount:
        pt = float(salary_structure.pt_monthly_amount)
        deductions_total += pt
    
    # TDS calculation (if enabled)
    if salary_structure.tds_mode == "MANUAL" and salary_structure.tds_monthly_amount:
        tds = float(salary_structure.tds_monthly_amount)
        deductions_total += tds
    
    # 5. Net pay = gross - deductions
    net_pay = gross_pay - deductions_total
    
    # ============ BREAKDOWN JSON (for payslip) ============
    
    breakdown = {
        "earnings": {
            "base_pay": float(base_pay),
            "overtime_pay": float(overtime_pay),
            "total_earnings": float(gross_pay),
        },
        "deductions": {
            "pf_employee": float(pf_employee),
            "pt": float(pt),
            "tds": float(tds),
            "other": float(other_deductions),
            "total_deductions": float(deductions_total),
        },
        "net_pay": float(net_pay),
        "payroll_config": {
            "monthly_gross": float(monthly_gross),
            "payroll_divisor_days": divisor_days,
            "standard_minutes_per_day": standard_minutes_per_day,
            "overtime_multiplier": float(overtime_multiplier),
            "daily_rate": float(daily_rate),
            "hourly_rate": float(hourly_rate),
            "overtime_rate": float(overtime_rate),
        },
        "attendance_summary": {
            "days_payable": float(days_payable),
            "days_lop": float(days_lop),
            "total_minutes_worked": total_minutes_worked,
            "overtime_minutes": overtime_minutes,
        },
    }
    
    return {
        "base_pay": float(base_pay),
        "overtime_pay": float(overtime_pay),
        "gross_pay": float(gross_pay),
        "pf_employee": float(pf_employee),
        "pf_employer": float(pf_employer),
        "esi_employee": float(esi_employee),
        "esi_employer": float(esi_employer),
        "pt": float(pt),
        "tds": float(tds),
        "other_deductions": float(other_deductions),
        "deductions_total": float(deductions_total),
        "net_pay": float(net_pay),
        "daily_rate": float(daily_rate),
        "hourly_rate": float(hourly_rate),
        "overtime_rate": float(overtime_rate),
        "overtime_minutes": overtime_minutes,
        "overtime_approved": overtime_approved,
        "breakdown_json": breakdown,
    }


def get_active_salary_structure(
    session: Session,
    user_id: int,
    for_date: Optional[datetime] = None,
) -> Optional[SalaryStructure]:
    """
    Get the active salary structure for a user on a given date.
    If no date provided, returns the most recent active structure.
    """
    if for_date is None:
        for_date = datetime.now().date()
    
    query = session.query(SalaryStructure).filter(
        SalaryStructure.user_id == user_id,
        SalaryStructure.effective_from <= for_date,
        SalaryStructure.is_active == True,
    ).order_by(SalaryStructure.effective_from.desc())
    
    # Check effective_to if present
    result = query.first()
    if result and result.effective_to and result.effective_to < for_date:
        return None
    
    return result


def calculate_attendance_from_work_sessions(
    session: Session,
    user_id: int,
    year: int,
    month: int,
    attendance_threshold_minutes: int = 120,
    standard_minutes_per_day: int = 480,
) -> Dict[str, Any]:
    """
    Calculate attendance metrics from work sessions for a given month.
    
    Args:
        session: Database session
        user_id: Employee ID
        year: Year (YYYY)
        month: Month (1-12)
        attendance_threshold_minutes: Min minutes to count as present (default 120 = 2h)
        standard_minutes_per_day: Standard work minutes per day (default 480 = 8h)
    
    Returns:
        Dict with:
        - days_payable: Days with attendance >= threshold (present)
        - days_lop: Days without attendance (absent/LOP)
        - total_overtime_minutes: Sum of minutes beyond standard_minutes_per_day
        - exceptions: List of flagged days (e.g., zero attendance)
    """
    from datetime import date
    from calendar import monthrange
    
    # Get all work sessions for the employee in this month
    from app.models.work_session import WorkSession
    
    start_date = date(year, month, 1)
    _, days_in_month = monthrange(year, month)
    end_date = date(year, month, days_in_month)
    
    work_sessions = session.query(WorkSession).filter(
        WorkSession.user_id == user_id,
        WorkSession.login_at >= start_date,
        WorkSession.logout_at <= end_date.isoformat() + " 23:59:59",
    ).all()
    
    # Group by day
    days_worked = {}
    for ws in work_sessions:
        day = ws.login_at.date()
        if day not in days_worked:
            days_worked[day] = 0
        days_worked[day] += ws.duration_minutes or 0
    
    # Calculate metrics
    days_payable = 0
    days_lop = 0
    total_overtime_minutes = 0
    exceptions = []
    
    for day_num in range(1, days_in_month + 1):
        current_date = date(year, month, day_num)
        
        # Skip weekends (Saturday=5, Sunday=6)
        if current_date.weekday() >= 5:
            continue
        
        minutes_worked = days_worked.get(current_date, 0)
        
        if minutes_worked >= attendance_threshold_minutes:
            days_payable += 1
            # Calculate overtime for this day
            if minutes_worked > standard_minutes_per_day:
                total_overtime_minutes += (minutes_worked - standard_minutes_per_day)
        else:
            days_lop += 1
            if minutes_worked == 0:
                exceptions.append({
                    "date": current_date.isoformat(),
                    "reason": "No work session (absent or missed punch)",
                    "minutes": 0,
                })
    
    return {
        "days_payable": days_payable,
        "days_lop": days_lop,
        "total_overtime_minutes": total_overtime_minutes,
        "exceptions": exceptions,
    }
