from __future__ import annotations

from decimal import Decimal

from sqlalchemy import ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin


class AssignmentFloorArea(IDMixin, TimestampMixin, Base):
    __tablename__ = "assignment_floor_areas"

    assignment_id: Mapped[int] = mapped_column(
        ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    floor_name: Mapped[str] = mapped_column(String(100), nullable=False)
    area: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    assignment: Mapped["Assignment"] = relationship(back_populates="floors")
