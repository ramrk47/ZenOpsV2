from __future__ import annotations

from typing import Optional

from sqlalchemy import Boolean, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, IDMixin, TimestampMixin


class PayrollPolicy(IDMixin, TimestampMixin, Base):
    """Company-wide payroll policy configuration"""
    __tablename__ = "payroll_policies"

    # Pay cycle configuration
    monthly_pay_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    full_day_minimum_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=480)  # 8 hours
    half_day_threshold_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=240)  # 4 hours
    grace_period_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=15)

    # LOP rules
    lop_on_absent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    lop_on_unapproved_leave: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    lop_on_late_threshold_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # e.g., 3 lates = 1 LOP

    # Overtime configuration
    overtime_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    overtime_multiplier: Mapped[Optional[float]] = mapped_column(Numeric(5, 2), nullable=True, default=1.5)
    overtime_requires_approval: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Statutory defaults (can be overridden per employee)
    pf_enabled_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    pf_employee_rate: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=12.0)  # percentage
    pf_employer_rate: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=12.0)  # percentage
    pf_wage_ceiling: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True, default=15000.0)  # INR

    esi_enabled_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    esi_employee_rate: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0.75)  # percentage
    esi_employer_rate: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=3.25)  # percentage
    esi_wage_ceiling: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True, default=21000.0)  # INR

    pt_enabled_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    pt_monthly_amount: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True, default=200.0)  # INR

    tds_enabled_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Leave impact rules (JSONB for flexibility)
    leave_type_impacts: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
        comment="Map leave types to paid/unpaid: {CASUAL: paid, SICK: paid, LWP: unpaid}"
    )

    # Weekly off & holidays (India-style)
    weekly_off_day: Mapped[int] = mapped_column(Integer, nullable=False, default=6, comment="0=Mon, 5=Sat, 6=Sun")
    annual_paid_leave_quota: Mapped[int] = mapped_column(Integer, nullable=False, default=21, comment="Annual leave days per employee")
    company_holidays: Mapped[Optional[list]] = mapped_column(
        JSONB,
        nullable=True,
        comment="List of company holidays: [{date: YYYY-MM-DD, name: str, paid: bool}]"
    )

    # Policy metadata
    policy_name: Mapped[str] = mapped_column(String(255), nullable=False, default="Default Payroll Policy")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
