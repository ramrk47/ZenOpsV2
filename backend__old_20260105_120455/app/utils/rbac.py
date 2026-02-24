"""
Role‑based access control.

Define roles and their associated capabilities.  A capability is a simple
string like `assignments.create` or `invoices.mark_paid`.  The mapping
below can be adjusted as the business logic evolves.  The functions in
this module are used throughout the application to verify that the
current user is allowed to perform a given action.
"""

from __future__ import annotations

from typing import Iterable, Set

from ..models.user import UserRole

# Define a set of capabilities for each role.  Capabilities follow
# dotted‑string naming to allow easy grouping in the frontend.
ROLE_CAPABILITIES: dict[UserRole, Set[str]] = {
    UserRole.ADMIN: {
        # Users
        "users.read",
        "users.create",
        "users.update",
        "users.deactivate",
        # Assignments
        "assignments.read",
        "assignments.create",
        "assignments.update",
        "assignments.delete",
        # Tasks/messages/documents
        "tasks.manage",
        "messages.manage",
        "documents.manage",
        # Approvals
        "approvals.manage",
        # Invoices
        "invoices.read",
        "invoices.create",
        "invoices.mark_paid",
        # Master data
        "masterdata.manage",
        # Leave and calendar
        "leave.manage",
        "calendar.manage",
    },
    UserRole.OPS_MANAGER: {
        "assignments.read",
        "assignments.create",
        "assignments.update",
        "tasks.manage",
        "messages.manage",
        "documents.manage",
        "approvals.manage",
        "invoices.read",
        # Ops managers should not create invoices, but can see them
        # Leave & calendar
        "leave.manage",
        "calendar.manage",
    },
    UserRole.HR: {
        "users.read",
        "users.create",
        "users.update",
        "leave.manage",
        "assignments.read",
        "messages.manage",
        "tasks.manage",
        # HR does not handle invoices
        "calendar.manage",
    },
    UserRole.FINANCE: {
        "assignments.read",
        "invoices.read",
        "invoices.create",
        "invoices.mark_paid",
        "messages.manage",
    },
    UserRole.ASSISTANT_VALUER: {
        "assignments.read",
        "assignments.create",
        "assignments.update",
        "tasks.manage",
        "messages.manage",
        "documents.manage",
        "calendar.manage",
    },
    UserRole.FIELD_VALUER: {
        "assignments.read",
        "assignments.update",
        "tasks.manage",
        "messages.manage",
        "calendar.manage",
    },
    UserRole.EMPLOYEE: {
        # Legacy role – minimal access
        "assignments.read",
        "messages.manage",
    },
}


def get_capabilities_for_user(user: "User") -> Set[str]:
    """Return the set of capabilities granted to a user based on their role."""
    return ROLE_CAPABILITIES.get(user.role, set())


def user_has_capability(user: "User", capability: str) -> bool:
    """Check whether the user has a specific capability.

    ADMIN users implicitly have all capabilities.
    """
    if user.role is None:
        return False
    if user.role == UserRole.ADMIN:
        return True
    return capability in ROLE_CAPABILITIES.get(user.role, set())