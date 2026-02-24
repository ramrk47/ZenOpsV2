from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.payroll_run import PayrollRun
    from app.models.salary_structure import SalaryStructure


class PayrollLineItem(IDMixin, TimestampMixin, Base):
    """Individual employee payroll line for a specific payroll run"""
    __tablename__ = "payroll_line_items"
    __table_args__ = (
        UniqueConstraint("payroll_run_id", "user_id", name="uq_payroll_run_user"),
    )

    payroll_run_id: Mapped[int] = mapped_column(
        ForeignKey("payroll_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    salary_structure_id: Mapped[int] = mapped_column(
        ForeignKey("salary_structures.id"),
        nullable=False,
        index=True,
        comment="Reference to salary structure used for this payroll"
    )

    # Attendance outcomes
    days_payable: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0.0)
    days_lop: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0.0)
    days_present: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0.0)
    days_absent: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0.0)
    days_leave_paid: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0.0)
    days_leave_unpaid: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0.0)

    # Time details
    total_minutes_worked: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    overtime_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    late_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    late_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Salary calculation (Hybrid model)
    base_monthly_salary: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0.0, comment="monthly_gross from salary structure")
    daily_rate: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0.0, comment="daily_rate = base_monthly / divisor_days")
    base_pay: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0.0, comment="base_pay = daily_rate * days_payable (fixed monthly component)")
    overtime_pay: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0.0, comment="overtime_pay = (total_overtime_minutes / 60) * overtime_rate")
    overtime_approved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="Only pay overtime if approved")
    gross_pay: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0.0, comment="gross_pay = base_pay + overtime_pay")

    # Deductions
    pf_employee: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0.0)
    pf_employer: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0.0)
    esi_employee: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0.0)
    esi_employer: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0.0)
    pt: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0.0)
    tds: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0.0)
    other_deductions: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0.0)
    deductions_total: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0.0)

    # Net pay
    net_pay: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0.0)

    # Component breakdown (for payslip generation)
    breakdown_json: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default={},
        comment="Full component breakdown: {earnings: {...}, deductions: {...}, adjustments: [...]}"
    )

    # Exceptions and overrides
    has_exceptions: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    exception_details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    override_applied: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    override_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    override_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)

    # Notes
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    payroll_run: Mapped["PayrollRun"] = relationship(back_populates="line_items")
    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    salary_structure: Mapped["SalaryStructure"] = relationship(foreign_keys=[salary_structure_id])
