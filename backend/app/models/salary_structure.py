from __future__ import annotations

from datetime import date
from typing import Optional, TYPE_CHECKING

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class SalaryStructure(IDMixin, TimestampMixin, Base):
    """Employee salary structure with effective dating"""
    __tablename__ = "salary_structures"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    effective_from: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    effective_to: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True)

    # Basic salary info
    monthly_ctc: Mapped[Optional[float]] = mapped_column(Numeric(12, 2), nullable=True)
    monthly_gross: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0.0, comment="Base gross for payroll calculation (hybrid model)")
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default="INR")

    # Hybrid payroll configuration (fixed monthly + overtime)
    standard_minutes_per_day: Mapped[int] = mapped_column(Integer, nullable=False, default=480, comment="Standard work minutes per day (default 8h = 480 min)")
    payroll_divisor_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30, comment="Days divisor for daily rate calculation")
    overtime_multiplier: Mapped[float] = mapped_column(Numeric(4, 2), nullable=False, default=2.0, comment="Multiplier for overtime rate")
    overtime_requires_approval: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, comment="Must admin approve overtime before payment")

    # Earnings components (JSONB for flexibility)
    earnings: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default={},
        comment="Earnings breakdown: {basic: 15000, hra: 7500, special_allowance: 10000, ...}"
    )

    # Deduction settings
    pf_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    pf_employee_rate: Mapped[Optional[float]] = mapped_column(Numeric(5, 2), nullable=True)
    pf_employer_rate: Mapped[Optional[float]] = mapped_column(Numeric(5, 2), nullable=True)

    esi_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    esi_employee_rate: Mapped[Optional[float]] = mapped_column(Numeric(5, 2), nullable=True)
    esi_employer_rate: Mapped[Optional[float]] = mapped_column(Numeric(5, 2), nullable=True)

    pt_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    pt_monthly_amount: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)

    tds_mode: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="MANUAL",
        comment="MANUAL or COMPUTED"
    )
    tds_monthly_amount: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)

    # Payment method (optional)
    bank_account_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    bank_ifsc: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    bank_beneficiary_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Status
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)

    # Relationships
    user: Mapped["User"] = relationship(back_populates="salary_structures")
