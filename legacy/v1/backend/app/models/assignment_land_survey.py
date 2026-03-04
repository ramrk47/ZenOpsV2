from __future__ import annotations

from decimal import Decimal

from sqlalchemy import ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin


class AssignmentLandSurvey(IDMixin, TimestampMixin, Base):
    __tablename__ = "assignment_land_surveys"

    assignment_id: Mapped[int] = mapped_column(
        ForeignKey("assignments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    serial_no: Mapped[int] = mapped_column(Integer, nullable=False)
    survey_no: Mapped[str] = mapped_column(String(120), nullable=False)
    acre: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False, default=Decimal("0"))
    gunta: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False, default=Decimal("0"))
    aana: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False, default=Decimal("0"))
    kharab_acre: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False, default=Decimal("0"))
    kharab_gunta: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False, default=Decimal("0"))
    kharab_aana: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False, default=Decimal("0"))

    assignment: Mapped["Assignment"] = relationship(back_populates="land_surveys")
