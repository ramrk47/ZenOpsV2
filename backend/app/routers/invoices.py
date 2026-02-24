from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import csv
import hashlib
import json
import logging
from io import StringIO
from pathlib import Path
from uuid import uuid4
from typing import List, Optional, Literal

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import or_, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core import rbac
from app.core.deps import get_current_user
from app.core.guards import require_destructive_allowed
from app.core.settings import settings
from app.core.step_up import require_step_up
from app.db.session import get_db
from app.models.approval import Approval
from app.models.assignment import Assignment
from app.models.audit import ActivityLog
from app.models.enums import (
    ApprovalActionType,
    ApprovalEntityType,
    ApprovalStatus,
    InvoiceStatus,
    PaymentMode,
    NotificationType,
    Role,
    TaskStatus,
)
from app.models.idempotency import IdempotencyKey
from app.models.invoice import (
    Invoice,
    InvoiceAdjustment,
    InvoiceAttachment,
    InvoicePayment,
)
from app.models.master import Branch, CompanyAccount, CompanyProfile
from app.models.task import AssignmentTask
from app.models.user import User
from app.schemas.approval import ApprovalRead
from app.schemas.invoice import (
    InvoiceAdjustmentCreate,
    InvoiceAttachmentRead,
    InvoiceCreate,
    InvoiceIssuePayload,
    InvoiceLedgerRow,
    InvoiceListResponse,
    InvoicePaymentCreate,
    InvoiceRead,
    InvoiceSendPayload,
    InvoiceUpdate,
    InvoiceVoidPayload,
)
from app.services.activity import log_activity
from app.services.approvals import request_approval, required_roles_for_approval
from app.services.assignments import apply_access_filter, ensure_assignment_access, get_assignment_assignee_ids, notify_assignment_assignees
from app.services.calendar import upsert_task_due_event
from app.services.notifications import create_notification_if_absent, notify_roles, notify_roles_if_absent
from app.services.invoice_pdf import generate_invoice_pdf
from app.services.invoices import (
    add_invoice_audit_log,
    default_issued_date,
    ensure_invoice_snapshot,
    generate_invoice_number,
    recompute_invoice_balance,
    recompute_invoice_totals,
    replace_invoice_items,
    snapshot_tax_breakdown,
)
from app.services.studio_billing import emit_invoice_event
from app.services.partners import notify_partner_users

router = APIRouter(prefix="/api/invoices", tags=["invoices"])
logger = logging.getLogger(__name__)

REMINDER_SCOPE = "invoice_remind"
REMINDER_COOLDOWN_HOURS = 24
REMINDER_USER_LIMIT = 10
REMINDER_USER_WINDOW_MINUTES = 10

SortDir = Literal["asc", "desc"]


def _require_invoice_view(user: User) -> None:
    caps = rbac.get_capabilities_for_user(user)
    if not caps.get("view_invoices") and not caps.get("view_all_assignments"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to view invoices")


def _require_invoice_modify(user: User) -> None:
    caps = rbac.get_capabilities_for_user(user)
    if not caps.get("modify_invoice"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to modify invoices")


def _require_invoice_money(user: User) -> None:
    if not rbac.can_modify_money(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to modify invoice payments")


def _get_invoice_or_404(db: Session, invoice_id: int) -> Invoice:
    invoice = (
        db.query(Invoice)
        .options(
            selectinload(Invoice.items),
            selectinload(Invoice.payments),
            selectinload(Invoice.adjustments),
            selectinload(Invoice.tax_breakdowns),
            selectinload(Invoice.audit_logs),
            selectinload(Invoice.attachments),
            selectinload(Invoice.assignment),
        )
        .filter(Invoice.id == invoice_id)
        .first()
    )
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
    return invoice


def _ensure_assignment_access(db: Session, assignment_id: int, user: User) -> Assignment:
    assignment = db.get(Assignment, assignment_id)
    if not assignment or assignment.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    try:
        ensure_assignment_access(assignment, user)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return assignment


def _get_company_profile(db: Session) -> CompanyProfile:
    profile = db.query(CompanyProfile).order_by(CompanyProfile.id.asc()).first()
    if profile:
        return profile
    profile = CompanyProfile(business_name="Pinnacle Consultants", default_gst_rate=Decimal("18.00"))
    db.add(profile)
    db.flush()
    return profile


def _select_company_account(
    db: Session,
    *,
    assignment: Assignment,
    preferred_account_id: int | None,
) -> CompanyAccount | None:
    if preferred_account_id:
        account = db.get(CompanyAccount, preferred_account_id)
        if not account or not account.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid company account")
        return account

    if assignment.bank_id:
        bank_account = (
            db.query(CompanyAccount)
            .filter(
                CompanyAccount.bank_id == assignment.bank_id,
                CompanyAccount.is_active.is_(True),
            )
            .order_by(CompanyAccount.is_primary.desc(), CompanyAccount.id.asc())
            .first()
        )
        if bank_account:
            return bank_account

    primary = (
        db.query(CompanyAccount)
        .filter(CompanyAccount.is_primary.is_(True), CompanyAccount.is_active.is_(True))
        .order_by(CompanyAccount.id.asc())
        .first()
    )
    if primary:
        return primary

    return (
        db.query(CompanyAccount)
        .filter(CompanyAccount.is_active.is_(True))
        .order_by(CompanyAccount.id.asc())
        .first()
    )


def _hash_payload(payload: dict) -> str:
    serialized = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _jsonable(payload: dict) -> dict:
    return json.loads(json.dumps(payload, default=str))


def _request_id(request: Request | None) -> Optional[str]:
    if not request:
        return None
    return request.headers.get("x-request-id")


def _log_security_event(
    event: str,
    *,
    request: Request | None,
    user: User | None,
    invoice_id: Optional[int] = None,
    extra: Optional[dict] = None,
) -> None:
    payload = {
        "event": event,
        "user_id": user.id if user else None,
        "invoice_id": invoice_id,
        "request_id": _request_id(request),
    }
    if extra:
        payload.update(extra)
    logger.info(json.dumps(payload, default=str))


def _recent_invoice_reminder(db: Session, *, invoice_id: int, within_hours: int = REMINDER_COOLDOWN_HOURS) -> bool:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=within_hours)
    recent_logs = (
        db.query(ActivityLog)
        .filter(ActivityLog.type == "INVOICE_REMINDER_SENT", ActivityLog.created_at >= cutoff)
        .order_by(ActivityLog.created_at.desc())
        .limit(200)
        .all()
    )
    for log in recent_logs:
        payload = log.payload_json or {}
        if payload.get("invoice_id") == invoice_id:
            return True
    return False


def _recent_user_reminders(db: Session, *, user_id: int, within_minutes: int = REMINDER_USER_WINDOW_MINUTES) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=within_minutes)
    return (
        db.query(ActivityLog)
        .filter(
            ActivityLog.actor_user_id == user_id,
            ActivityLog.type == "INVOICE_REMINDER_SENT",
            ActivityLog.created_at >= cutoff,
        )
        .count()
    )


def _select_finance_assignee(db: Session, *, fallback_user_id: int) -> User:
    finance_user = (
        db.query(User)
        .filter(User.has_role(Role.FINANCE), User.is_active.is_(True))
        .order_by(User.id.asc())
        .first()
    )
    if finance_user:
        return finance_user
    admin_user = (
        db.query(User)
        .filter(User.has_role(Role.ADMIN), User.is_active.is_(True))
        .order_by(User.id.asc())
        .first()
    )
    if admin_user:
        return admin_user
    fallback = db.get(User, fallback_user_id)
    if fallback:
        return fallback
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No active finance/admin user found")


def _invoice_to_ledger_row(invoice: Invoice) -> InvoiceLedgerRow:
    is_overdue = bool(
        invoice.due_date and invoice.amount_due > Decimal("0.00") and invoice.due_date < datetime.now(timezone.utc).date()
    )
    last_payment = None
    if invoice.payments:
        safe_min = datetime.min.replace(tzinfo=timezone.utc)
        last_payment = max(
            invoice.payments,
            key=lambda payment: ((payment.paid_at or safe_min), payment.id),
        )
    items_count = len(invoice.items or [])
    item_preview = []
    if invoice.items:
        for item in sorted(invoice.items, key=lambda row: (row.order_index, row.id)):
            item_preview.append(
                {
                    "description": item.description,
                    "quantity": item.quantity,
                    "line_total": item.line_total,
                }
            )
            if len(item_preview) >= 2:
                break
    payload = {
        "id": invoice.id,
        "assignment_id": invoice.assignment_id,
        "assignment_code": invoice.assignment_code,
        "invoice_number": invoice.invoice_number,
        "status": invoice.status,
        "issued_at": invoice.issued_date,
        "due_date": invoice.due_date,
        "is_overdue": is_overdue,
        "currency": invoice.currency,
        "subtotal": invoice.subtotal,
        "tax_total": invoice.tax_amount,
        "grand_total": invoice.total_amount,
        "amount_paid": invoice.amount_paid,
        "amount_due": invoice.amount_due,
        "amount_credited": invoice.amount_credited,
        "items_count": items_count,
        "last_payment_at": last_payment.paid_at if last_payment else None,
        "last_payment_amount": last_payment.amount if last_payment else None,
        "item_preview": item_preview,
        "party_name": invoice.party_name,
        "bank_name": invoice.bank_name,
        "branch_name": invoice.branch_name,
        "created_at": invoice.created_at,
    }
    return InvoiceLedgerRow(**payload)


@router.get("", response_model=InvoiceListResponse)
def list_invoices(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    assignment_id: Optional[int] = Query(None),
    status_filter: Optional[InvoiceStatus] = Query(None, alias="status"),
    unpaid: Optional[bool] = Query(None),
    overdue: Optional[bool] = Query(None),
    issued_from: Optional[date] = Query(None),
    issued_to: Optional[date] = Query(None),
    due_from: Optional[date] = Query(None),
    due_to: Optional[date] = Query(None),
    bank_id: Optional[int] = Query(None),
    branch_id: Optional[int] = Query(None),
    client_id: Optional[int] = Query(None),
    amount_min: Optional[Decimal] = Query(None),
    amount_max: Optional[Decimal] = Query(None),
    search: Optional[str] = Query(None),
    sort_by: str = Query("due_date"),
    sort_dir: SortDir = Query("asc"),
    create_followups: bool = Query(False),
    overdue_days: int = Query(7, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InvoiceListResponse:
    _require_invoice_view(current_user)
    if create_followups:
        _require_invoice_modify(current_user)
        _create_overdue_followups(db, current_user=current_user, overdue_days=overdue_days)

    query = db.query(Invoice).join(Assignment).filter(Assignment.is_deleted.is_(False))
    query = apply_access_filter(query, current_user)

    if assignment_id:
        assignment = _ensure_assignment_access(db, assignment_id, current_user)
        query = query.filter(Invoice.assignment_id == assignment.id)
    if status_filter:
        query = query.filter(Invoice.status == status_filter)
    if unpaid is True:
        query = query.filter(Invoice.amount_due > Decimal("0.00"))
    if unpaid is False:
        query = query.filter(Invoice.amount_due <= Decimal("0.00"))
    if overdue is True:
        today = datetime.now(timezone.utc).date()
        query = query.filter(Invoice.due_date.isnot(None), Invoice.due_date < today, Invoice.amount_due > Decimal("0.00"))
    if overdue is False:
        today = datetime.now(timezone.utc).date()
        query = query.filter(
            or_(
                Invoice.due_date.is_(None),
                Invoice.due_date >= today,
                Invoice.amount_due <= Decimal("0.00"),
            )
        )
    if issued_from:
        query = query.filter(Invoice.issued_date >= issued_from)
    if issued_to:
        query = query.filter(Invoice.issued_date <= issued_to)
    if due_from:
        query = query.filter(Invoice.due_date >= due_from)
    if due_to:
        query = query.filter(Invoice.due_date <= due_to)
    if bank_id:
        query = query.filter(func.coalesce(Invoice.bank_id, Assignment.bank_id) == bank_id)
    if branch_id:
        query = query.filter(func.coalesce(Invoice.branch_id, Assignment.branch_id) == branch_id)
    if client_id:
        query = query.filter(func.coalesce(Invoice.client_id, Assignment.client_id) == client_id)
    if amount_min is not None:
        query = query.filter(Invoice.total_amount >= amount_min)
    if amount_max is not None:
        query = query.filter(Invoice.total_amount <= amount_max)
    if search:
        term = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(Invoice.invoice_number).ilike(term),
                func.lower(Assignment.assignment_code).ilike(term),
                func.lower(Assignment.borrower_name).ilike(term),
                func.lower(Assignment.bank_name).ilike(term),
                func.lower(Assignment.branch_name).ilike(term),
                func.lower(Assignment.valuer_client_name).ilike(term),
                func.lower(Invoice.bill_to_name).ilike(term),
            )
        )

    sort_columns = {
        "issued_date": Invoice.issued_date,
        "due_date": Invoice.due_date,
        "amount_due": Invoice.amount_due,
        "grand_total": Invoice.total_amount,
        "status": Invoice.status,
        "created_at": Invoice.created_at,
        "invoice_number": Invoice.invoice_number,
    }
    sort_column = sort_columns.get(sort_by, Invoice.due_date)
    query = query.order_by(sort_column.desc() if sort_dir == "desc" else sort_column.asc())

    total = query.order_by(None).count()
    offset = (page - 1) * page_size

    invoices = (
        query.options(
            selectinload(Invoice.assignment),
            selectinload(Invoice.payments),
            selectinload(Invoice.items),
        )
        .offset(offset)
        .limit(page_size)
        .all()
    )
    items = [_invoice_to_ledger_row(inv) for inv in invoices]

    has_more = offset + page_size < total
    next_page = page + 1 if has_more else None
    prev_page = page - 1 if page > 1 else None

    return InvoiceListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        has_more=has_more,
        next_page=next_page,
        prev_page=prev_page,
    )


@router.get("/export.csv")
def export_invoices_csv(
    assignment_id: Optional[int] = Query(None),
    status_filter: Optional[InvoiceStatus] = Query(None, alias="status"),
    unpaid: Optional[bool] = Query(None),
    overdue: Optional[bool] = Query(None),
    issued_from: Optional[date] = Query(None),
    issued_to: Optional[date] = Query(None),
    due_from: Optional[date] = Query(None),
    due_to: Optional[date] = Query(None),
    bank_id: Optional[int] = Query(None),
    branch_id: Optional[int] = Query(None),
    client_id: Optional[int] = Query(None),
    amount_min: Optional[Decimal] = Query(None),
    amount_max: Optional[Decimal] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_invoice_view(current_user)

    query = db.query(Invoice).join(Assignment).filter(Assignment.is_deleted.is_(False))
    query = apply_access_filter(query, current_user)

    if assignment_id:
        assignment = _ensure_assignment_access(db, assignment_id, current_user)
        query = query.filter(Invoice.assignment_id == assignment.id)
    if status_filter:
        query = query.filter(Invoice.status == status_filter)
    if unpaid is True:
        query = query.filter(Invoice.amount_due > Decimal("0.00"))
    if unpaid is False:
        query = query.filter(Invoice.amount_due <= Decimal("0.00"))
    if overdue is True:
        today = datetime.now(timezone.utc).date()
        query = query.filter(Invoice.due_date.isnot(None), Invoice.due_date < today, Invoice.amount_due > Decimal("0.00"))
    if overdue is False:
        today = datetime.now(timezone.utc).date()
        query = query.filter(
            or_(
                Invoice.due_date.is_(None),
                Invoice.due_date >= today,
                Invoice.amount_due <= Decimal("0.00"),
            )
        )
    if issued_from:
        query = query.filter(Invoice.issued_date >= issued_from)
    if issued_to:
        query = query.filter(Invoice.issued_date <= issued_to)
    if due_from:
        query = query.filter(Invoice.due_date >= due_from)
    if due_to:
        query = query.filter(Invoice.due_date <= due_to)
    if bank_id:
        query = query.filter(func.coalesce(Invoice.bank_id, Assignment.bank_id) == bank_id)
    if branch_id:
        query = query.filter(func.coalesce(Invoice.branch_id, Assignment.branch_id) == branch_id)
    if client_id:
        query = query.filter(func.coalesce(Invoice.client_id, Assignment.client_id) == client_id)
    if amount_min is not None:
        query = query.filter(Invoice.total_amount >= amount_min)
    if amount_max is not None:
        query = query.filter(Invoice.total_amount <= amount_max)
    if search:
        term = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(Invoice.invoice_number).ilike(term),
                func.lower(Assignment.assignment_code).ilike(term),
                func.lower(Assignment.borrower_name).ilike(term),
                func.lower(Assignment.bank_name).ilike(term),
                func.lower(Assignment.branch_name).ilike(term),
                func.lower(Assignment.valuer_client_name).ilike(term),
                func.lower(Invoice.bill_to_name).ilike(term),
            )
        )

    invoices = query.options(selectinload(Invoice.assignment)).order_by(Invoice.issued_date.desc()).all()

    def iter_rows():
        buffer = StringIO()
        writer = csv.writer(buffer)
        writer.writerow([
            "invoice_number",
            "status",
            "issued_date",
            "due_date",
            "is_overdue",
            "assignment_code",
            "party_name",
            "bank_name",
            "branch_name",
            "currency",
            "subtotal",
            "tax_total",
            "grand_total",
            "amount_paid",
            "amount_due",
            "amount_credited",
        ])
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)

        today = datetime.now(timezone.utc).date()
        for invoice in invoices:
            is_overdue = bool(
                invoice.due_date and invoice.amount_due > Decimal("0.00") and invoice.due_date < today
            )
            writer.writerow([
                invoice.invoice_number or "",
                invoice.status,
                invoice.issued_date,
                invoice.due_date or "",
                "yes" if is_overdue else "no",
                invoice.assignment_code or "",
                invoice.party_name or "",
                invoice.bank_name or "",
                invoice.branch_name or "",
                invoice.currency,
                invoice.subtotal,
                invoice.tax_amount,
                invoice.total_amount,
                invoice.amount_paid,
                invoice.amount_due,
                invoice.amount_credited,
            ])
            yield buffer.getvalue()
            buffer.seek(0)
            buffer.truncate(0)

    filename = f"invoices_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}.csv"
    return StreamingResponse(
        iter_rows(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


def _create_overdue_followups(db: Session, *, current_user: User, overdue_days: int) -> int:
    today = datetime.now(timezone.utc).date()
    cutoff_date = today - timedelta(days=overdue_days)

    overdue_invoices = (
        db.query(Invoice)
        .filter(
            Invoice.amount_due > Decimal("0.00"),
            Invoice.due_date.isnot(None),
            Invoice.due_date <= cutoff_date,
            Invoice.status.in_([InvoiceStatus.ISSUED, InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID]),
        )
        .all()
    )
    if not overdue_invoices:
        return 0

    assignee = _select_finance_assignee(db, fallback_user_id=current_user.id)
    created = 0

    for invoice in overdue_invoices:
        assignment = invoice.assignment
        if not assignment or assignment.is_deleted:
            continue

        existing = (
            db.query(AssignmentTask)
            .filter(
                AssignmentTask.invoice_id == invoice.id,
                AssignmentTask.template_type == "invoice_overdue",
            )
            .first()
        )
        if existing:
            continue

        overdue_by = (today - invoice.due_date).days if invoice.due_date else None
        amount_due = invoice.amount_due
        title = f"Follow up: {invoice.invoice_number or invoice.id} overdue"
        description = (
            f"Invoice {invoice.invoice_number or invoice.id} for {assignment.assignment_code} is overdue by {overdue_by} days. "
            f"Amount due: {amount_due}."
        )

        try:
            task = AssignmentTask(
                assignment_id=assignment.id,
                invoice_id=invoice.id,
                title=title,
                description=description,
                status=TaskStatus.TODO,
                assigned_to_user_id=assignee.id if assignee else None,
                due_at=datetime.now(timezone.utc) + timedelta(days=2),
                created_by_user_id=current_user.id,
                template_type="invoice_overdue",
            )
            db.add(task)
            db.flush()

            upsert_task_due_event(db, task=task, assignment=assignment, actor_user_id=current_user.id)

            log_activity(
                db,
                actor_user_id=current_user.id,
                activity_type="INVOICE_FOLLOWUP_TASK_CREATED",
                assignment_id=assignment.id,
                message=f"Follow-up task created for {invoice.invoice_number or invoice.id}",
                payload={"invoice_id": invoice.id, "task_id": task.id},
            )

            if assignee and assignee.id:
                create_notification_if_absent(
                    db,
                    user_id=assignee.id,
                    notif_type=NotificationType.TASK_ASSIGNED,
                    message=f"Follow up on invoice {invoice.invoice_number or invoice.id}",
                    payload={"task_id": task.id, "invoice_id": invoice.id, "assignment_id": assignment.id},
                    payload_match={"invoice_id": invoice.id, "task_id": task.id},
                    within_minutes=1440,
                )

            if overdue_by is not None and overdue_by >= 30:
                notify_roles_if_absent(
                    db,
                    roles=[Role.ADMIN],
                    notif_type=NotificationType.PAYMENT_PENDING,
                    message=f"Invoice overdue 30+ days: {invoice.invoice_number or invoice.id}",
                    payload={"invoice_id": invoice.id, "assignment_id": assignment.id},
                    payload_match={"invoice_id": invoice.id},
                    within_minutes=1440,
                    exclude_user_ids=[current_user.id],
                )

            db.commit()
            created += 1
        except IntegrityError:
            db.rollback()
            continue

    return created


@router.get("/{invoice_id}", response_model=InvoiceRead)
def get_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InvoiceRead:
    _require_invoice_view(current_user)
    invoice = _get_invoice_or_404(db, invoice_id)
    _ensure_assignment_access(db, invoice.assignment_id, current_user)
    return InvoiceRead.model_validate(invoice)


@router.post("", response_model=InvoiceRead, status_code=status.HTTP_201_CREATED)
def create_invoice(
    invoice_in: InvoiceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InvoiceRead:
    caps = rbac.get_capabilities_for_user(current_user)
    if not caps.get("create_invoice") and not caps.get("modify_money"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to create invoices")

    assignment = _ensure_assignment_access(db, invoice_in.assignment_id, current_user)
    profile = _get_company_profile(db)

    account = _select_company_account(
        db,
        assignment=assignment,
        preferred_account_id=invoice_in.company_account_id,
    )

    if invoice_in.tax_rate is None:
        tax_rate = Decimal(profile.default_gst_rate or Decimal("0.00"))
    else:
        tax_rate = Decimal(invoice_in.tax_rate)

    invoice = Invoice(
        assignment_id=assignment.id,
        partner_id=assignment.partner_id,
        invoice_number=None,
        issued_date=default_issued_date(invoice_in.issued_date),
        due_date=invoice_in.due_date,
        status=InvoiceStatus.DRAFT,
        tax_rate=tax_rate,
        notes=invoice_in.notes,
        created_by_user_id=current_user.id,
        company_account_id=account.id if account else None,
        currency=invoice_in.currency or "INR",
        bill_to_name=invoice_in.bill_to_name,
        bill_to_address=invoice_in.bill_to_address,
        bill_to_gstin=invoice_in.bill_to_gstin,
        place_of_supply=invoice_in.place_of_supply,
        terms=invoice_in.terms,
        bank_id=invoice_in.bank_id,
        branch_id=invoice_in.branch_id,
        client_id=invoice_in.client_id,
    )
    ensure_invoice_snapshot(invoice, assignment)
    db.add(invoice)
    db.flush()

    items_payload = [item.model_dump() for item in invoice_in.items]
    if not items_payload and assignment.fees:
        items_payload = [
            {
                "description": f"Valuation Fees ({assignment.assignment_code})",
                "quantity": Decimal("1.00"),
                "unit_price": Decimal(assignment.fees),
                "order_index": 0,
            }
        ]

    replace_invoice_items(db, invoice, items_payload)
    recompute_invoice_totals(invoice)
    recompute_invoice_balance(invoice)
    db.add(invoice)

    add_invoice_audit_log(
        db,
        invoice_id=invoice.id,
        event_type="created",
        actor_user_id=current_user.id,
        diff=_jsonable(invoice_in.model_dump(exclude={"items"})),
    )

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="INVOICE_CREATED",
        assignment_id=assignment.id,
        message=f"Invoice created: {invoice.invoice_number or invoice.id}",
        payload={"invoice_id": invoice.id},
    )

    notify_assignment_assignees(
        db,
        assignment,
        notif_type=NotificationType.PAYMENT_PENDING,
        message=f"Invoice created: {invoice.invoice_number or invoice.id}",
        payload={"invoice_id": invoice.id, "assignment_id": assignment.id},
        exclude_user_ids=[current_user.id],
    )

    db.commit()
    db.refresh(invoice)
    emit_invoice_event("invoice_created", invoice)
    return InvoiceRead.model_validate(invoice)


@router.patch("/{invoice_id}", response_model=InvoiceRead)
def update_invoice(
    invoice_id: int,
    invoice_update: InvoiceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InvoiceRead:
    _require_invoice_modify(current_user)

    invoice = _get_invoice_or_404(db, invoice_id)
    _ensure_assignment_access(db, invoice.assignment_id, current_user)

    if invoice.status != InvoiceStatus.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only draft invoices can be edited")

    update_data = invoice_update.model_dump(exclude_unset=True)
    items_payload = update_data.pop("items", None)

    for field, value in update_data.items():
        setattr(invoice, field, value)

    if items_payload is not None:
        replace_invoice_items(db, invoice, items_payload)

    recompute_invoice_totals(invoice)
    recompute_invoice_balance(invoice)
    db.add(invoice)

    add_invoice_audit_log(
        db,
        invoice_id=invoice.id,
        event_type="edited",
        actor_user_id=current_user.id,
        diff=_jsonable(update_data),
    )

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="INVOICE_UPDATED",
        assignment_id=invoice.assignment_id,
        message=f"Invoice updated: {invoice.invoice_number or invoice.id}",
        payload={"invoice_id": invoice.id},
    )

    db.commit()
    db.refresh(invoice)
    return InvoiceRead.model_validate(invoice)


@router.post("/{invoice_id}/issue", response_model=InvoiceRead)
def issue_invoice(
    invoice_id: int,
    payload: InvoiceIssuePayload | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InvoiceRead:
    caps = rbac.get_capabilities_for_user(current_user)
    if not caps.get("create_invoice") and not caps.get("modify_invoice"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to issue invoices")

    invoice = _get_invoice_or_404(db, invoice_id)
    _ensure_assignment_access(db, invoice.assignment_id, current_user)

    if invoice.status != InvoiceStatus.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invoice already issued")

    assignment = invoice.assignment
    if assignment:
        ensure_invoice_snapshot(invoice, assignment)
    if not invoice.items and assignment and assignment.fees:
        replace_invoice_items(
            db,
            invoice,
            [
                {
                    "description": f"Valuation Fees ({assignment.assignment_code})",
                    "quantity": Decimal("1.00"),
                    "unit_price": Decimal(assignment.fees),
                    "order_index": 0,
                }
            ],
        )

    issued_date = payload.issued_date if payload else None
    invoice.issued_date = default_issued_date(issued_date)
    if payload and payload.due_date:
        invoice.due_date = payload.due_date

    if not invoice.invoice_number:
        invoice.invoice_number = generate_invoice_number(db, issued_date=invoice.issued_date)

    invoice.status = InvoiceStatus.ISSUED
    recompute_invoice_totals(invoice)
    recompute_invoice_balance(invoice)
    db.add(invoice)

    profile = _get_company_profile(db)
    branch = None
    if invoice.branch_id:
        branch = db.get(Branch, invoice.branch_id)
    snapshot_tax_breakdown(db, invoice=invoice, assignment=assignment, profile=profile, branch=branch)

    add_invoice_audit_log(
        db,
        invoice_id=invoice.id,
        event_type="issued",
        actor_user_id=current_user.id,
        diff={"issued_date": str(invoice.issued_date), "invoice_number": invoice.invoice_number},
    )

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="INVOICE_ISSUED",
        assignment_id=invoice.assignment_id,
        message=f"Invoice issued: {invoice.invoice_number}",
        payload={"invoice_id": invoice.id},
    )
    if assignment:
        notify_assignment_assignees(
            db,
            assignment,
            notif_type=NotificationType.PAYMENT_PENDING,
            message=f"Invoice issued: {invoice.invoice_number}",
            payload={"invoice_id": invoice.id, "assignment_id": assignment.id},
            exclude_user_ids=[current_user.id],
        )
    db.commit()
    db.refresh(invoice)
    emit_invoice_event("invoice_issued", invoice)
    return InvoiceRead.model_validate(invoice)


@router.post("/{invoice_id}/send", response_model=InvoiceRead)
def send_invoice(
    invoice_id: int,
    payload: InvoiceSendPayload | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InvoiceRead:
    _require_invoice_modify(current_user)
    invoice = _get_invoice_or_404(db, invoice_id)
    _ensure_assignment_access(db, invoice.assignment_id, current_user)

    if invoice.status not in {InvoiceStatus.ISSUED, InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invoice not in a sendable state")

    invoice.sent_at = payload.sent_at if payload and payload.sent_at else datetime.now(timezone.utc)
    if invoice.status == InvoiceStatus.ISSUED:
        invoice.status = InvoiceStatus.SENT
    db.add(invoice)

    add_invoice_audit_log(
        db,
        invoice_id=invoice.id,
        event_type="sent",
        actor_user_id=current_user.id,
        diff={"sent_at": invoice.sent_at.isoformat()},
    )

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="INVOICE_SENT",
        assignment_id=invoice.assignment_id,
        message=f"Invoice sent: {invoice.invoice_number or invoice.id}",
        payload={"invoice_id": invoice.id},
    )

    db.commit()
    db.refresh(invoice)
    emit_invoice_event("invoice_sent", invoice)
    return InvoiceRead.model_validate(invoice)


@router.post("/{invoice_id}/void", response_model=InvoiceRead)
def void_invoice(
    invoice_id: int,
    payload: InvoiceVoidPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _step_up: dict = Depends(require_step_up),
) -> InvoiceRead:
    _require_invoice_modify(current_user)
    invoice = _get_invoice_or_404(db, invoice_id)
    _ensure_assignment_access(db, invoice.assignment_id, current_user)

    if invoice.status == InvoiceStatus.VOID:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invoice already voided")
    if invoice.amount_paid > Decimal("0.00"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Refund/credit note required before voiding")

    invoice.status = InvoiceStatus.VOID
    invoice.voided_at = datetime.now(timezone.utc)
    invoice.void_reason = payload.reason
    invoice.voided_by_user_id = current_user.id
    invoice.amount_due = Decimal("0.00")
    invoice.is_paid = False
    db.add(invoice)

    add_invoice_audit_log(
        db,
        invoice_id=invoice.id,
        event_type="voided",
        actor_user_id=current_user.id,
        diff={"reason": payload.reason},
    )

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="INVOICE_VOIDED",
        assignment_id=invoice.assignment_id,
        message=f"Invoice voided: {invoice.invoice_number or invoice.id}",
        payload={"invoice_id": invoice.id, "reason": payload.reason},
    )

    db.commit()
    db.refresh(invoice)
    emit_invoice_event("invoice_voided", invoice)
    return InvoiceRead.model_validate(invoice)


@router.post("/{invoice_id}/payments", response_model=InvoiceRead)
def add_payment(
    invoice_id: int,
    payload: InvoicePaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InvoiceRead:
    _require_invoice_money(current_user)
    invoice = _get_invoice_or_404(db, invoice_id)
    _ensure_assignment_access(db, invoice.assignment_id, current_user)

    if invoice.status == InvoiceStatus.VOID:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot pay a voided invoice")
    if invoice.status == InvoiceStatus.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Issue the invoice before recording payment")

    amount = Decimal(payload.amount)
    if amount <= Decimal("0.00"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment amount must be positive")
    if invoice.amount_due <= Decimal("0.00"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invoice already settled")
    if amount > invoice.amount_due:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment exceeds amount due")

    paid_at = payload.paid_at or datetime.now(timezone.utc)
    was_paid = invoice.is_paid
    payment = InvoicePayment(
        invoice_id=invoice.id,
        amount=amount,
        paid_at=paid_at,
        mode=payload.mode,
        reference_no=payload.reference_no,
        notes=payload.notes,
        created_by_user_id=current_user.id,
    )
    db.add(payment)
    invoice.payments.append(payment)
    recompute_invoice_balance(invoice)
    db.add(invoice)

    add_invoice_audit_log(
        db,
        invoice_id=invoice.id,
        event_type="payment_recorded",
        actor_user_id=current_user.id,
        diff={"amount": str(amount), "mode": str(payload.mode)},
    )

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="INVOICE_PAYMENT_RECORDED",
        assignment_id=invoice.assignment_id,
        message=f"Payment recorded for {invoice.invoice_number or invoice.id}",
        payload={"invoice_id": invoice.id, "amount": str(amount)},
    )

    if invoice.partner_id and invoice.is_paid and not was_paid:
        notify_partner_users(
            db,
            partner_id=invoice.partner_id,
            notif_type=NotificationType.PARTNER_PAYMENT_VERIFIED,
            message=f"Payment verified for invoice {invoice.invoice_number or invoice.id}",
            payload={"invoice_id": invoice.id, "assignment_id": invoice.assignment_id},
        )

    db.commit()
    db.refresh(invoice)
    emit_invoice_event("payment_recorded", invoice, payment=payment)
    if invoice.is_paid and not was_paid:
        emit_invoice_event("invoice_paid", invoice, payment=payment)
    return InvoiceRead.model_validate(invoice)


@router.post("/{invoice_id}/adjustments", response_model=InvoiceRead)
def add_adjustment(
    invoice_id: int,
    payload: InvoiceAdjustmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InvoiceRead:
    _require_invoice_modify(current_user)
    invoice = _get_invoice_or_404(db, invoice_id)
    _ensure_assignment_access(db, invoice.assignment_id, current_user)

    if invoice.status == InvoiceStatus.VOID:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot adjust a voided invoice")
    if invoice.status == InvoiceStatus.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Issue the invoice before adjusting")

    amount = Decimal(payload.amount)
    if amount <= Decimal("0.00"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Adjustment amount must be positive")
    if amount > invoice.total_amount:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Adjustment exceeds invoice total")

    issued_at = payload.issued_at or datetime.now(timezone.utc)
    adjustment = InvoiceAdjustment(
        invoice_id=invoice.id,
        amount=amount,
        adjustment_type=payload.adjustment_type,
        reason=payload.reason,
        issued_at=issued_at,
        created_by_user_id=current_user.id,
    )
    db.add(adjustment)
    invoice.adjustments.append(adjustment)
    recompute_invoice_balance(invoice)
    db.add(invoice)

    add_invoice_audit_log(
        db,
        invoice_id=invoice.id,
        event_type="adjustment_added",
        actor_user_id=current_user.id,
        diff={"amount": str(amount), "type": str(payload.adjustment_type)},
    )

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="INVOICE_ADJUSTMENT_ADDED",
        assignment_id=invoice.assignment_id,
        message=f"Adjustment added for {invoice.invoice_number or invoice.id}",
        payload={"invoice_id": invoice.id, "amount": str(amount)},
    )

    db.commit()
    db.refresh(invoice)
    return InvoiceRead.model_validate(invoice)


@router.post("/{invoice_id}/mark-paid", response_model=InvoiceRead | ApprovalRead)
def mark_paid(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InvoiceRead | ApprovalRead:
    invoice = _get_invoice_or_404(db, invoice_id)
    _ensure_assignment_access(db, invoice.assignment_id, current_user)

    if rbac.can_modify_money(current_user):
        amount = invoice.amount_due
        if amount <= Decimal("0.00"):
            return InvoiceRead.model_validate(invoice)
        payment = InvoicePayment(
            invoice_id=invoice.id,
            amount=amount,
            paid_at=datetime.now(timezone.utc),
            mode=PaymentMode.MANUAL,
            created_by_user_id=current_user.id,
            notes="Marked paid",
        )
        db.add(payment)
        invoice.payments.append(payment)
        recompute_invoice_balance(invoice)
        db.add(invoice)

        add_invoice_audit_log(
            db,
            invoice_id=invoice.id,
            event_type="payment_recorded",
            actor_user_id=current_user.id,
            diff={"amount": str(amount), "mode": str(PaymentMode.MANUAL)},
        )

        log_activity(
            db,
            actor_user_id=current_user.id,
            activity_type="INVOICE_MARKED_PAID",
            assignment_id=invoice.assignment_id,
            message=f"Invoice paid: {invoice.invoice_number or invoice.id}",
            payload={"invoice_id": invoice.id},
        )
        db.commit()
        db.refresh(invoice)
        emit_invoice_event("payment_recorded", invoice, payment=payment)
        emit_invoice_event("invoice_paid", invoice, payment=payment)
        return InvoiceRead.model_validate(invoice)

    approval = Approval(
        entity_type=ApprovalEntityType.INVOICE,
        entity_id=invoice.id,
        action_type=ApprovalActionType.MARK_PAID,
        requester_user_id=current_user.id,
        approver_user_id=None,
        status=ApprovalStatus.PENDING,
        reason="Mark invoice paid",
        payload_json={"invoice_number": invoice.invoice_number},
        assignment_id=invoice.assignment_id,
    )
    allowed_roles = required_roles_for_approval(approval.entity_type, approval.action_type)
    request_approval(db, approval=approval, allowed_roles=allowed_roles, auto_assign=False)
    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="INVOICE_MARK_PAID_REQUESTED",
        assignment_id=invoice.assignment_id,
        payload={"invoice_id": invoice.id, "approval_id": approval.id},
    )
    notify_roles(
        db,
        roles=allowed_roles,
        notif_type=NotificationType.APPROVAL_PENDING,
        message=f"Approval requested: {approval.action_type}",
        payload={"approval_id": approval.id, "invoice_id": invoice.id, "assignment_id": invoice.assignment_id},
        exclude_user_ids=[current_user.id],
    )
    db.commit()
    db.refresh(approval)
    return ApprovalRead.model_validate(approval)


@router.post("/{invoice_id}/remind", response_model=dict)
def remind_invoice(
    invoice_id: int,
    request: Request,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if not rbac.can_modify_money(current_user):
        _log_security_event("invoice_reminder_forbidden", request=request, user=current_user, invoice_id=invoice_id)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to send reminders")

    invoice = _get_invoice_or_404(db, invoice_id)
    _ensure_assignment_access(db, invoice.assignment_id, current_user)

    if invoice.amount_due <= Decimal("0.00") or invoice.status == InvoiceStatus.VOID:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invoice already settled or voided")

    assignment = invoice.assignment
    if not assignment:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invoice is missing assignment context")

    request_hash = _hash_payload({"invoice_id": invoice_id, "user_id": current_user.id})
    if idempotency_key:
        existing = (
            db.query(IdempotencyKey)
            .filter(
                IdempotencyKey.key == idempotency_key,
                IdempotencyKey.scope == REMINDER_SCOPE,
                IdempotencyKey.user_id == current_user.id,
            )
            .first()
        )
        if existing:
            if existing.request_hash != request_hash:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Idempotency key mismatch")
            if existing.response_payload is not None:
                return existing.response_payload
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Idempotency key already used")

    recent_user_count = _recent_user_reminders(db, user_id=current_user.id)
    if recent_user_count >= REMINDER_USER_LIMIT:
        log_activity(
            db,
            actor_user_id=current_user.id,
            activity_type="INVOICE_REMINDER_BLOCKED_RATE_LIMIT",
            assignment_id=assignment.id,
            message=f"Reminder rate limit hit for {invoice.invoice_number or invoice.id}",
            payload={"invoice_id": invoice.id},
        )
        _log_security_event(
            "invoice_reminder_rate_limited",
            request=request,
            user=current_user,
            invoice_id=invoice_id,
            extra={"recent_count": recent_user_count},
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Reminder rate limit exceeded")

    if _recent_invoice_reminder(db, invoice_id=invoice.id):
        log_activity(
            db,
            actor_user_id=current_user.id,
            activity_type="INVOICE_REMINDER_BLOCKED_DEDUPE",
            assignment_id=assignment.id,
            message=f"Reminder already sent for {invoice.invoice_number or invoice.id}",
            payload={"invoice_id": invoice.id},
        )
        _log_security_event("invoice_reminder_deduped", request=request, user=current_user, invoice_id=invoice_id)
        db.commit()
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Reminder already sent in last 24 hours")

    assignee_ids = get_assignment_assignee_ids(assignment)
    finance_admin_ids = [
        user.id
        for user in db.query(User).filter(User.has_any_role([Role.FINANCE, Role.ADMIN]), User.is_active.is_(True)).all()
    ]
    recipient_ids = {int(uid) for uid in assignee_ids + finance_admin_ids if uid}

    message = f"Payment reminder: {invoice.invoice_number or invoice.id}"
    for user_id in recipient_ids:
        create_notification_if_absent(
            db,
            user_id=user_id,
            notif_type=NotificationType.PAYMENT_PENDING,
            message=message,
            payload={"invoice_id": invoice.id, "assignment_id": assignment.id},
            payload_match={"invoice_id": invoice.id},
            within_minutes=REMINDER_COOLDOWN_HOURS * 60,
        )

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="INVOICE_REMINDER_SENT",
        assignment_id=assignment.id,
        message=f"Reminder sent for {invoice.invoice_number or invoice.id}",
        payload={"invoice_id": invoice.id},
    )

    response_payload = {
        "status": "ok",
        "invoice_id": invoice.id,
        "message": f"Reminder sent for {invoice.invoice_number or invoice.id}",
    }

    if idempotency_key:
        db.add(
            IdempotencyKey(
                key=idempotency_key,
                scope=REMINDER_SCOPE,
                user_id=current_user.id,
                request_hash=request_hash,
                response_payload=response_payload,
            )
        )

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if idempotency_key:
            existing = (
                db.query(IdempotencyKey)
                .filter(
                    IdempotencyKey.key == idempotency_key,
                    IdempotencyKey.scope == REMINDER_SCOPE,
                    IdempotencyKey.user_id == current_user.id,
                )
                .first()
            )
            if existing and existing.response_payload is not None:
                return existing.response_payload
        raise

    return response_payload


@router.get("/{invoice_id}/context", response_model=dict)
def invoice_context(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    invoice = _get_invoice_or_404(db, invoice_id)
    _ensure_assignment_access(db, invoice.assignment_id, current_user)

    profile = _get_company_profile(db)
    account = _select_company_account(db, assignment=invoice.assignment, preferred_account_id=invoice.company_account_id)

    if account and invoice.company_account_id != account.id:
        invoice.company_account_id = account.id
        db.add(invoice)
        db.commit()
        db.refresh(invoice)

    return {
        "invoice": InvoiceRead.model_validate(invoice).model_dump(),
        "assignment": {
            "id": invoice.assignment.id,
            "assignment_code": invoice.assignment.assignment_code,
            "borrower_name": invoice.assignment.borrower_name,
            "bank_name": invoice.assignment.bank_name,
            "branch_name": invoice.assignment.branch_name,
            "fees": str(invoice.assignment.fees) if invoice.assignment.fees is not None else None,
        },
        "company_profile": {
            "business_name": profile.business_name,
            "legal_name": profile.legal_name,
            "tagline": profile.tagline,
            "address_line1": profile.address_line1,
            "address_line2": profile.address_line2,
            "city": profile.city,
            "state_name": profile.state_name,
            "state_code": profile.state_code,
            "postal_code": profile.postal_code,
            "country": profile.country,
            "gstin": profile.gstin,
            "pan": profile.pan,
            "contact_email": profile.contact_email,
            "contact_phone": profile.contact_phone,
            "website": profile.website,
            "default_gst_rate": str(profile.default_gst_rate) if profile.default_gst_rate is not None else None,
        },
        "company_account": account and {
            "id": account.id,
            "bank_id": account.bank_id,
            "account_name": account.account_name,
            "account_number": account.account_number,
            "ifsc_code": account.ifsc_code,
            "bank_name": account.bank_name,
            "branch_name": account.branch_name,
            "upi_id": account.upi_id,
        },
    }


def _invoice_upload_dir(invoice: Invoice) -> Path:
    base = settings.ensure_uploads_dir()
    ref = invoice.invoice_number or f"draft-{invoice.id}"
    path = base / "invoices" / ref
    path.mkdir(parents=True, exist_ok=True)
    return path


@router.get("/{invoice_id}/attachments", response_model=list[InvoiceAttachmentRead])
def list_invoice_attachments(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[InvoiceAttachmentRead]:
    _require_invoice_view(current_user)
    invoice = _get_invoice_or_404(db, invoice_id)
    _ensure_assignment_access(db, invoice.assignment_id, current_user)
    return [InvoiceAttachmentRead.model_validate(doc) for doc in invoice.attachments]


@router.post("/{invoice_id}/attachments/upload", response_model=InvoiceAttachmentRead, status_code=status.HTTP_201_CREATED)
def upload_invoice_attachment(
    invoice_id: int,
    file: UploadFile = File(...),
    category: str | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InvoiceAttachmentRead:
    _require_invoice_modify(current_user)
    invoice = _get_invoice_or_404(db, invoice_id)
    _ensure_assignment_access(db, invoice.assignment_id, current_user)

    upload_dir = _invoice_upload_dir(invoice)
    # Sanitize filename to prevent path traversal
    safe_filename = Path(file.filename or "upload.bin").name
    suffix = Path(safe_filename).suffix
    filename = f"{uuid4().hex}{suffix}"
    storage_path = upload_dir / filename

    content = file.file.read()
    storage_path.write_bytes(content)

    attachment = InvoiceAttachment(
        invoice_id=invoice.id,
        uploaded_by_user_id=current_user.id,
        original_name=file.filename or filename,
        storage_path=str(storage_path),
        mime_type=file.content_type,
        size=len(content),
        category=category,
    )
    db.add(attachment)
    db.flush()

    add_invoice_audit_log(
        db,
        invoice_id=invoice.id,
        event_type="attachment_added",
        actor_user_id=current_user.id,
        diff={"attachment_id": attachment.id, "name": attachment.original_name},
    )

    db.commit()
    db.refresh(attachment)
    return InvoiceAttachmentRead.model_validate(attachment)


@router.get("/{invoice_id}/attachments/{attachment_id}/download")
def download_invoice_attachment(
    invoice_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_invoice_view(current_user)
    invoice = _get_invoice_or_404(db, invoice_id)
    _ensure_assignment_access(db, invoice.assignment_id, current_user)

    attachment = db.get(InvoiceAttachment, attachment_id)
    if not attachment or attachment.invoice_id != invoice_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    path = Path(attachment.storage_path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stored file missing")
    return FileResponse(path=path, filename=attachment.original_name, media_type=attachment.mime_type)


@router.delete("/{invoice_id}/attachments/{attachment_id}", response_model=dict)
def delete_invoice_attachment(
    invoice_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    require_destructive_allowed("delete_invoice_attachment")
    _require_invoice_modify(current_user)
    invoice = _get_invoice_or_404(db, invoice_id)
    _ensure_assignment_access(db, invoice.assignment_id, current_user)

    attachment = db.get(InvoiceAttachment, attachment_id)
    if not attachment or attachment.invoice_id != invoice_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")

    path = Path(attachment.storage_path)
    if path.exists():
        path.unlink()
    db.delete(attachment)

    add_invoice_audit_log(
        db,
        invoice_id=invoice.id,
        event_type="attachment_deleted",
        actor_user_id=current_user.id,
        diff={"attachment_id": attachment_id},
    )

    db.commit()
    return {"status": "ok", "attachment_id": attachment_id}


@router.get("/{invoice_id}/pdf")
def get_invoice_pdf(
    invoice_id: int,
    regenerate: bool = Query(False, description="Force regeneration even if a PDF already exists"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> FileResponse:
    _require_invoice_view(current_user)
    invoice = _get_invoice_or_404(db, invoice_id)
    assignment = _ensure_assignment_access(db, invoice.assignment_id, current_user)

    if not invoice.invoice_number:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Issue the invoice before generating a PDF")

    profile = _get_company_profile(db)

    # Ensure account is bank-aware with primary fallback.
    account = _select_company_account(db, assignment=assignment, preferred_account_id=invoice.company_account_id)
    if account and invoice.company_account_id != account.id:
        invoice.company_account_id = account.id

    # Default GST rate comes from company profile unless explicitly set.
    if invoice.tax_rate is None:
        invoice.tax_rate = Decimal(profile.default_gst_rate or Decimal("0.00"))

    recompute_invoice_totals(invoice)
    recompute_invoice_balance(invoice)

    existing_path = Path(invoice.pdf_path) if invoice.pdf_path else None
    if existing_path and existing_path.exists() and not regenerate:
        return FileResponse(path=str(existing_path), filename=existing_path.name, media_type="application/pdf")

    pdf_path = generate_invoice_pdf(
        invoice=invoice,
        assignment=assignment,
        profile=profile,
        account=account,
    )
    invoice.pdf_generated_by_user_id = current_user.id
    db.add(invoice)

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="INVOICE_PDF_GENERATED",
        assignment_id=assignment.id,
        message=f"Invoice PDF generated: {invoice.invoice_number}",
        payload={"invoice_id": invoice.id, "pdf_path": str(pdf_path)},
    )

    db.commit()
    db.refresh(invoice)

    return FileResponse(path=str(pdf_path), filename=pdf_path.name, media_type="application/pdf")
