from __future__ import annotations

from datetime import datetime
from typing import Optional, TYPE_CHECKING, List

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin
from app.models.enums import PayrollRunStatus

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.payslip import Payslip


class PayrollRun(IDMixin, TimestampMixin, Base):
    """Monthly payroll run with state machine"""
    __tablename__ = "payroll_runs"

    # Period
    month: Mapped[str] = mapped_column(
        String(7),
        nullable=False,
        unique=True,
        index=True,
        comment="YYYY-MM format"
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    month_num: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    # Status and workflow
    status: Mapped[PayrollRunStatus] = mapped_column(
        Enum(PayrollRunStatus, name="payroll_run_status"),
        nullable=False,
        default=PayrollRunStatus.DRAFT,
        index=True
    )

    # Audit trail
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
        index=True
    )
    calculated_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    calculated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    approved_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    paid_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    locked_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    locked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Config snapshot (policy settings used for this run)
    config_snapshot: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default={},
        comment="Snapshot of payroll policy at time of calculation"
    )

    # Totals
    employee_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_gross: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    total_deductions: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0.0)
    total_net: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0.0)

    # Statutory totals
    total_pf_employee: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0.0)
    total_pf_employer: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0.0)
    total_esi_employee: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0.0)
    total_esi_employer: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0.0)
    total_pt: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0.0)
    total_tds: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0.0)

    # Notes and exceptions
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    exception_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Relationships
    creator: Mapped["User"] = relationship(foreign_keys=[created_by], lazy="joined")
    line_items: Mapped[List["PayrollLineItem"]] = relationship(
        back_populates="payroll_run",
        cascade="all, delete-orphan"
    )
    payslips: Mapped[List["Payslip"]] = relationship(
        back_populates="payroll_run",
        cascade="all, delete-orphan"
    )
