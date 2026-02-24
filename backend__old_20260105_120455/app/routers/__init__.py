"""
Expose all routers for easy import into the FastAPI application.

Each router module defines its own prefix and tags.
"""

from . import auth, users, assignments, tasks, messages, documents, approvals, invoices, calendar, notifications, leave, master  # noqa: F401

__all__ = [
    "auth",
    "users",
    "assignments",
    "tasks",
    "messages",
    "documents",
    "approvals",
    "invoices",
    "calendar",
    "notifications",
    "leave",
    "master",
]