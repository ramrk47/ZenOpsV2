from __future__ import annotations

from datetime import datetime
from typing import Iterable, List, Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, JSON, String, or_, type_coerce
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IDMixin, TimestampMixin
from app.models.enums import Role


class User(IDMixin, TimestampMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    role: Mapped[Role] = mapped_column(Enum(Role, name="role"), default=Role.EMPLOYEE, nullable=False, index=True)
    roles: Mapped[Optional[list[str]]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    capability_overrides: Mapped[Optional[dict]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"),
        nullable=True,
    )
    totp_secret: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    backup_codes_hash: Mapped[Optional[list]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"),
        nullable=True,
    )
    whatsapp_opted_in: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    whatsapp_consent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    whatsapp_number: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    partner_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("external_partners.id"),
        nullable=True,
        index=True,
    )

    partner: Mapped[Optional["ExternalPartner"]] = relationship(back_populates="users")

    salary_structures: Mapped[List["SalaryStructure"]] = relationship(back_populates="user", cascade="all, delete-orphan")

    assignments_created: Mapped[List["Assignment"]] = relationship(
        back_populates="creator",
        foreign_keys="Assignment.created_by_user_id",
    )
    assignments_assigned: Mapped[List["Assignment"]] = relationship(
        back_populates="assignee",
        foreign_keys="Assignment.assigned_to_user_id",
    )
    assignment_assignee_links: Mapped[List["AssignmentAssignee"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )

    tasks_created: Mapped[List["AssignmentTask"]] = relationship(
        back_populates="creator",
        foreign_keys="AssignmentTask.created_by_user_id",
    )
    tasks_assigned: Mapped[List["AssignmentTask"]] = relationship(
        back_populates="assignee",
        foreign_keys="AssignmentTask.assigned_to_user_id",
    )

    messages_sent: Mapped[List["AssignmentMessage"]] = relationship(back_populates="sender")
    documents_uploaded: Mapped[List["AssignmentDocument"]] = relationship(
        back_populates="uploader",
        foreign_keys="AssignmentDocument.uploaded_by_user_id",
    )

    approvals_requested: Mapped[List["Approval"]] = relationship(
        back_populates="requester",
        foreign_keys="Approval.requester_user_id",
    )
    approvals_to_decide: Mapped[List["Approval"]] = relationship(
        back_populates="approver",
        foreign_keys="Approval.approver_user_id",
    )

    leave_requests: Mapped[List["LeaveRequest"]] = relationship(
        back_populates="requester",
        foreign_keys="LeaveRequest.requester_user_id",
    )
    leave_approvals: Mapped[List["LeaveRequest"]] = relationship(
        back_populates="approver",
        foreign_keys="LeaveRequest.approver_user_id",
    )

    calendar_events_created: Mapped[List["CalendarEvent"]] = relationship(
        back_populates="creator",
        foreign_keys="CalendarEvent.created_by_user_id",
    )
    calendar_events_assigned: Mapped[List["CalendarEvent"]] = relationship(
        back_populates="assignee",
        foreign_keys="CalendarEvent.assigned_to_user_id",
    )

    notifications: Mapped[List["Notification"]] = relationship(back_populates="user")
    notification_deliveries: Mapped[List["NotificationDelivery"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    notification_preferences: Mapped[Optional["UserNotificationPreference"]] = relationship(
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    activities: Mapped[List["ActivityLog"]] = relationship(back_populates="actor")

    invoices_created: Mapped[List["Invoice"]] = relationship(
        back_populates="creator",
        foreign_keys="Invoice.created_by_user_id",
    )
    invoices_pdf_generated: Mapped[List["Invoice"]] = relationship(
        back_populates="pdf_generator",
        foreign_keys="Invoice.pdf_generated_by_user_id",
    )

    followup_tasks_created: Mapped[List["FollowUpTask"]] = relationship(
        back_populates="creator",
        foreign_keys="FollowUpTask.created_by_user_id",
    )
    followup_tasks_assigned: Mapped[List["FollowUpTask"]] = relationship(
        back_populates="assignee",
        foreign_keys="FollowUpTask.assigned_to_user_id",
    )
    relationship_logs_created: Mapped[List["RelationshipLog"]] = relationship(
        back_populates="creator",
        foreign_keys="RelationshipLog.created_by_user_id",
    )

    @classmethod
    def has_role(cls, role: Role):
        return or_(cls.role == role, type_coerce(cls.roles, JSONB).contains([role.value]))

    @classmethod
    def has_any_role(cls, roles: Iterable[Role]):
        role_list = list(roles)
        if not role_list:
            return cls.role.is_(None)
        return or_(*[cls.has_role(role) for role in role_list])
