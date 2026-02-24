from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Date, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin


class AnalyticsSettings(IDMixin, TimestampMixin, Base):
    __tablename__ = "analytics_settings"

    time_window_days: Mapped[int] = mapped_column(Integer, default=90, nullable=False)
    decline_threshold_count: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.30"), nullable=False)
    decline_threshold_revenue: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.25"), nullable=False)
    inactivity_days: Mapped[int] = mapped_column(Integer, default=21, nullable=False)
    baseline_min_count: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    baseline_min_revenue: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("50000.00"), nullable=False)
    followup_cooldown_days: Mapped[int] = mapped_column(Integer, default=21, nullable=False)
    outstanding_threshold: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)


class FollowUpTask(IDMixin, TimestampMixin, Base):
    __tablename__ = "follow_up_tasks"

    entity_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    entity_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    entity_label: Mapped[str] = mapped_column(String(255), nullable=False)
    reason_code: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), default="OPEN", nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(12), default="MEDIUM", nullable=False)

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    assigned_to_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    payload: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    dedupe_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)

    assignee: Mapped[Optional["User"]] = relationship(
        foreign_keys=[assigned_to_user_id],
        back_populates="followup_tasks_assigned",
    )
    creator: Mapped["User"] = relationship(
        foreign_keys=[created_by_user_id],
        back_populates="followup_tasks_created",
    )


class RelationshipLog(IDMixin, TimestampMixin, Base):
    __tablename__ = "relationship_logs"

    entity_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    entity_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    entity_label: Mapped[str] = mapped_column(String(255), nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False)
    next_follow_up_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    creator: Mapped["User"] = relationship(
        foreign_keys=[created_by_user_id],
        back_populates="relationship_logs_created",
    )
