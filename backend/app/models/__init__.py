"""Import all models so SQLAlchemy metadata is fully registered."""

from app.db.base import Base

from app.models.approval import Approval
from app.models.assignment import Assignment
from app.models.assignment_assignee import AssignmentAssignee
from app.models.assignment_floor import AssignmentFloorArea
from app.models.analytics import AnalyticsSettings, FollowUpTask, RelationshipLog
from app.models.audit import ActivityLog
from app.models.calendar import CalendarEvent
from app.models.document import AssignmentDocument
from app.models.document_comment import DocumentComment, CommentLane
from app.models.document_template import DocumentTemplate
from app.models.idempotency import IdempotencyKey
from app.models.enums import (
    ApprovalActionType,
    ApprovalEntityType,
    ApprovalStatus,
    AssignmentStatus,
    CalendarEventType,
    CaseType,
    CommissionRequestStatus,
    InvoiceAdjustmentType,
    InvoiceStatus,
    LeaveStatus,
    LeaveType,
    NotificationType,
    NotificationChannel,
    NotificationDeliveryStatus,
    PaymentMode,
    PartnerRequestDirection,
    PartnerRequestEntityType,
    PartnerRequestStatus,
    PartnerRequestType,
    PayrollAdjustmentType,
    PayrollRunStatus,
    Role,
    SupportPriority,
    SupportThreadStatus,
    SalaryComponentType,
    TaskStatus,
)
from app.models.invoice import (
    Invoice,
    InvoiceAdjustment,
    InvoiceAttachment,
    InvoiceAuditLog,
    InvoiceItem,
    InvoicePayment,
    InvoiceSequence,
    InvoiceTaxBreakdown,
)
from app.models.leave import LeaveRequest
from app.models.payroll_line_item import PayrollLineItem
from app.models.payslip import Payslip
from app.models.salary_structure import SalaryStructure
from app.models.payroll_run import PayrollRun
from app.models.master import (
    Bank,
    Branch,
    CalendarEventLabel,
    Client,
    CompanyAccount,
    CompanyProfile,
    DocumentChecklistTemplate,
    PropertySubtype,
    PropertyType,
)
from app.models.message import AssignmentMessage
from app.models.notification import Notification
from app.models.notification_delivery import NotificationDelivery
from app.models.notification_pref import UserNotificationPreference
from app.models.revoked_token import RevokedToken
from app.models.partner import (
    CommissionRequest,
    CommissionRequestDocument,
    ExternalPartner,
    PartnerDeliverable,
    PartnerRequest,
    PartnerRequestAttachment,
)
from app.models.partner_account_request import PartnerAccountRequest
from app.models.support import SupportThread, SupportMessage
from app.models.task import AssignmentTask
from app.models.user import User
from app.models.work_session import WorkSession

__all__ = [
    "Base",
    "User",
    "Role",
    "Assignment",
    "AssignmentAssignee",
    "AssignmentFloorArea",
    "AssignmentStatus",
    "CaseType",
    "CommissionRequestStatus",
    "AssignmentDocument",
    "AssignmentTask",
    "TaskStatus",
    "AssignmentMessage",
    "Approval",
    "ApprovalStatus",
    "ApprovalEntityType",
    "ApprovalActionType",
    "LeaveRequest",
    "LeaveType",
    "LeaveStatus",
    "CalendarEvent",
    "CalendarEventType",
    "Notification",
    "NotificationType",
    "NotificationChannel",
    "NotificationDeliveryStatus",
    "PartnerRequestDirection",
    "PartnerRequestEntityType",
    "PartnerRequestStatus",
    "PartnerRequestType",
    "ActivityLog",
    "IdempotencyKey",
    "AnalyticsSettings",
    "FollowUpTask",
    "RelationshipLog",
    "Invoice",
    "InvoicePayment",
    "InvoiceAdjustment",
    "InvoiceTaxBreakdown",
    "InvoiceAuditLog",
    "InvoiceAttachment",
    "InvoiceSequence",
    "InvoiceItem",
    "InvoiceStatus",
    "InvoiceAdjustmentType",
    "PaymentMode",
    "Bank",
    "Branch",
    "Client",
    "PropertyType",
    "PropertySubtype",
    "CompanyAccount",
    "CompanyProfile",
    "CalendarEventLabel",
    "DocumentChecklistTemplate",
    "ExternalPartner",
    "CommissionRequest",
    "CommissionRequestDocument",
    "PartnerRequest",
    "PartnerRequestAttachment",
    "PartnerDeliverable",
    "NotificationDelivery",
    "UserNotificationPreference",
    "RevokedToken",
    "WorkSession",
    "PartnerAccountRequest",
    "PayrollRun",
    "PayrollLineItem",
    "Payslip",
    "SalaryStructure",
    "PayrollRunStatus",
    "SalaryComponentType",
    "PayrollAdjustmentType",
    "DocumentComment",
    "CommentLane",
    "DocumentTemplate",
    "SupportThread",
    "SupportMessage",
]
