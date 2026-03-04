"""Rate-limit attempt log for public associate access requests."""

from __future__ import annotations

from typing import Optional

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, IDMixin, TimestampMixin


class PartnerRequestAttempt(IDMixin, TimestampMixin, Base):
    __tablename__ = "partner_request_attempts"

    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    request_ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    rate_limit_bucket: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
