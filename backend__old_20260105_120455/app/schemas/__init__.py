"""
Pydantic schemas for request and response payloads.

Schemas separate internal ORM models from the external API contract.  The
`from_orm = True` configuration allows automatic construction of
schemas from SQLAlchemy models.
"""

from .auth import Token, TokenPayload  # noqa: F401
from .user import UserBase, UserCreate, UserRead, UserUpdate  # noqa: F401
from .assignment import (
    AssignmentBase,
    AssignmentCreate,
    AssignmentRead,
    AssignmentUpdate,
    AssignmentListItem,
    AssignmentDetail,
)  # noqa: F401
from .invoice import InvoiceBase, InvoiceCreate, InvoiceRead, InvoiceUpdate, InvoiceItemCreate, InvoiceItemRead  # noqa: F401
from .master import BankRead, BranchRead, ClientRead, PropertyTypeRead  # noqa: F401
from .document import DocumentRead  # noqa: F401
from .task import TaskBase, TaskCreate, TaskRead, TaskUpdate  # noqa: F401
from .message import MessageBase, MessageCreate, MessageRead  # noqa: F401
from .approval import ApprovalCreate, ApprovalRead  # noqa: F401
from .leave import LeaveRequestCreate, LeaveRequestRead  # noqa: F401
from .calendar import CalendarEventRead, CalendarEventCreate  # noqa: F401
from .notification import NotificationRead  # noqa: F401
from .audit import ActivityRead  # noqa: F401