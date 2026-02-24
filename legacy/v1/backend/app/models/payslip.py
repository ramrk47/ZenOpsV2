from __future__ import annotations

from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.payroll_run import PayrollRun


class Payslip(IDMixin, TimestampMixin, Base):
    """Generated payslip artifact for employee"""
    __tablename__ = "payslips"
    __table_args__ = (
        UniqueConstraint("payroll_run_id", "user_id", name="uq_payslip_run_user"),
        UniqueConstraint("payslip_number", name="uq_payslip_number"),
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

    # Payslip identification
    payslip_number: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        unique=True,
        index=True,
        comment="e.g., PS-202601-001"
    )

    # Artifact storage
    pdf_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    html_content: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # Text type

    # Generation metadata
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True
    )
    generated_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    # Delivery status (integrates with email worker)
    email_sent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    email_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    email_delivery_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("notification_deliveries.id"),
        nullable=True
    )

    # Download tracking
    downloaded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    download_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Relationships
    payroll_run: Mapped["PayrollRun"] = relationship(back_populates="payslips")
    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    generator: Mapped["User"] = relationship(foreign_keys=[generated_by])
