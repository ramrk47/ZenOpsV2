"""
User model and role definitions.

Users authenticate with email/password credentials and are assigned a
role that grants them a set of capabilities via RBAC.  Passwords are
stored hashed using bcrypt.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Optional

from sqlalchemy import Column, Integer, String, Boolean, DateTime, Enum
from sqlalchemy.orm import relationship

from .base import Base


class UserRole(StrEnum):
    ADMIN = "ADMIN"
    OPS_MANAGER = "OPS_MANAGER"
    HR = "HR"
    FINANCE = "FINANCE"
    ASSISTANT_VALUER = "ASSISTANT_VALUER"
    FIELD_VALUER = "FIELD_VALUER"
    EMPLOYEE = "EMPLOYEE"


class User(Base):
    __tablename__ = "users"

    id: int = Column(Integer, primary_key=True, index=True)
    email: str = Column(String(255), unique=True, nullable=False, index=True)
    full_name: Optional[str] = Column(String(255), nullable=True)
    hashed_password: str = Column(String(255), nullable=False)
    role: UserRole = Column(Enum(UserRole), nullable=False, default=UserRole.EMPLOYEE)
    is_active: bool = Column(Boolean, nullable=False, default=True)
    created_at: datetime = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: datetime = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    assignments_created = relationship(
        "Assignment",
        back_populates="creator",
        foreign_keys="Assignment.created_by_user_id",
    )
    assignments_assigned = relationship(
        "Assignment",
        back_populates="assignee",
        foreign_keys="Assignment.assigned_to_user_id",
    )
    tasks_created = relationship(
        "AssignmentTask",
        back_populates="creator",
        foreign_keys="AssignmentTask.created_by_user_id",
    )
    tasks_assigned = relationship(
        "AssignmentTask",
        back_populates="assignee",
        foreign_keys="AssignmentTask.assigned_to_user_id",
    )
    messages_sent = relationship(
        "AssignmentMessage",
        back_populates="sender",
    )
    approvals_requested = relationship(
        "Approval",
        back_populates="requester",
        foreign_keys="Approval.requester_user_id",
    )
    approvals_assigned = relationship(
        "Approval",
        back_populates="approver",
        foreign_keys="Approval.approver_user_id",
    )
    leaves = relationship(
        "LeaveRequest",
        back_populates="requester",
        foreign_keys="LeaveRequest.requester_user_id",
    )
    invoices_created = relationship(
        "Invoice",
        back_populates="creator",
        foreign_keys="Invoice.created_by_user_id",
    )
    calendar_events_created = relationship(
        "CalendarEvent",
        back_populates="creator",
        foreign_keys="CalendarEvent.created_by_user_id",
    )
    calendar_events_assigned = relationship(
        "CalendarEvent",
        back_populates="assignee",
        foreign_keys="CalendarEvent.assigned_to_user_id",
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<User id={self.id} email={self.email} role={self.role}>"