from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin
from app.models.enums import SupportThreadStatus, SupportPriority, AuthorType


class SupportThread(IDMixin, TimestampMixin, Base):
    __tablename__ = "support_threads"

    assignment_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("assignments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_by_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_via: Mapped[AuthorType] = mapped_column(
        Enum(AuthorType, name="author_type"), nullable=False, default=AuthorType.INTERNAL
    )
    status: Mapped[SupportThreadStatus] = mapped_column(
        Enum(SupportThreadStatus, name="support_thread_status"),
        nullable=False,
        default=SupportThreadStatus.OPEN,
        index=True,
    )
    priority: Mapped[SupportPriority] = mapped_column(
        Enum(SupportPriority, name="support_priority"),
        nullable=False,
        default=SupportPriority.MEDIUM,
        index=True,
    )
    subject: Mapped[str] = mapped_column(String(500), nullable=False)
    last_message_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    assignment: Mapped[Optional["Assignment"]] = relationship(back_populates="support_threads")
    created_by: Mapped["User"] = relationship(foreign_keys=[created_by_user_id])
    messages: Mapped[list["SupportMessage"]] = relationship(
        back_populates="thread", cascade="all, delete-orphan", order_by="SupportMessage.created_at"
    )


class SupportMessage(IDMixin, TimestampMixin, Base):
    __tablename__ = "support_messages"

    thread_id: Mapped[int] = mapped_column(
        ForeignKey("support_threads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    author_type: Mapped[AuthorType] = mapped_column(
        Enum(AuthorType, name="author_type"), nullable=False
    )
    author_label: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    message_text: Mapped[str] = mapped_column(Text, nullable=False)
    attachments_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    message_metadata: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # Relationships
    thread: Mapped["SupportThread"] = relationship(back_populates="messages")
    author: Mapped[Optional["User"]] = relationship(foreign_keys=[author_user_id])


class SupportToken(IDMixin, TimestampMixin, Base):
    __tablename__ = "support_tokens"

    token_hash: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    assignment_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("assignments.id", ondelete="CASCADE"), nullable=True, index=True
    )
    thread_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("support_threads.id", ondelete="CASCADE"), nullable=True, index=True
    )
    created_by_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    used_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Relationships
    assignment: Mapped[Optional["Assignment"]] = relationship()
    thread: Mapped[Optional["SupportThread"]] = relationship()
    created_by: Mapped["User"] = relationship()


class EmailDeliveryLog(IDMixin, TimestampMixin, Base):
    __tablename__ = "email_delivery_logs"

    event_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    idempotency_key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    to_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    subject: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="QUEUED", index=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False, default="resend")
    provider_message_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    payload_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)


class SystemConfig(IDMixin, TimestampMixin, Base):
    __tablename__ = "system_config"

    config_key: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    config_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    config_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="STRING"
    )  # STRING, INT, BOOL, JSON
    is_public: Mapped[bool] = mapped_column(nullable=False, default=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
