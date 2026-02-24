"""
Expose all SQLAlchemy models for alembic autogeneration and convenience.

Importing this module makes all model classes available on the `models`
package, which Alembic uses to discover table definitions.
"""

from .user import User, UserRole  # noqa: F401
from .assignment import Assignment, AssignmentStatus, CaseType  # noqa: F401
from .invoice import Invoice, InvoiceItem, InvoiceStatus  # noqa: F401
from .master import Bank, Branch, Client, PropertyType  # noqa: F401
from .document import AssignmentDocument  # noqa: F401
from .task import AssignmentTask, TaskStatus  # noqa: F401
from .message import AssignmentMessage  # noqa: F401
from .approval import Approval, ApprovalStatus  # noqa: F401
from .leave import LeaveRequest, LeaveType, LeaveStatus  # noqa: F401
from .calendar import CalendarEvent, EventType  # noqa: F401
from .notification import Notification, NotificationType  # noqa: F401
from .audit import ActivityLog  # noqa: F401