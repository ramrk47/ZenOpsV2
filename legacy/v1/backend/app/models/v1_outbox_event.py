from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, IDMixin, TimestampMixin, utcnow


class V1OutboxEvent(IDMixin, TimestampMixin, Base):
    __tablename__ = "v1_outbox_events"

    event_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(120), nullable=False)
    payload_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="PENDING", index=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    delivered_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
