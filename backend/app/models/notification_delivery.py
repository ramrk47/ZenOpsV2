from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin
from app.models.enums import NotificationChannel, NotificationDeliveryStatus


class NotificationDelivery(IDMixin, TimestampMixin, Base):
    __tablename__ = "notification_deliveries"

    notification_id: Mapped[int] = mapped_column(
        ForeignKey("notifications.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    channel: Mapped[NotificationChannel] = mapped_column(
        Enum(NotificationChannel, name="notification_channel"),
        nullable=False,
        index=True,
    )
    status: Mapped[NotificationDeliveryStatus] = mapped_column(
        Enum(NotificationDeliveryStatus, name="notification_delivery_status"),
        nullable=False,
        index=True,
    )
    to_address: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)
    entity_key: Mapped[Optional[str]] = mapped_column(String(120), nullable=True, index=True)
    provider_message_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(default=0, nullable=False)
    last_attempt_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    notification: Mapped["Notification"] = relationship(back_populates="deliveries")
    user: Mapped["User"] = relationship(back_populates="notification_deliveries")

    @property
    def notification_type(self):
        return getattr(self.notification, "type", None)

    @property
    def notification_message(self):
        return getattr(self.notification, "message", None)

    @property
    def user_email(self):
        return getattr(self.user, "email", None)
