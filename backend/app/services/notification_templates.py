from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.core.settings import settings
from app.models.assignment import Assignment
from app.models.enums import NotificationType, PartnerRequestEntityType, Role
from app.models.invoice import Invoice
from app.models.notification import Notification
from app.models.partner import CommissionRequest, PartnerRequest


def build_email_content(
    db: Session,
    *,
    notification: Notification,
    recipient_role: Role,
) -> Optional[dict]:
    notif_type = notification.type
    payload = notification.payload_json or {}
    base_url = settings.app_base_url.rstrip("/")

    if recipient_role == Role.EXTERNAL_PARTNER:
        return _build_partner_email(db, notif_type, notification.message, payload, base_url)
    return _build_internal_email(notif_type, notification.message, payload, base_url)


def _build_partner_email(
    db: Session,
    notif_type: NotificationType,
    message: str,
    payload: dict,
    base_url: str,
) -> Optional[dict]:
    commission = _resolve_commission(db, payload)
    assignment = _resolve_assignment(db, payload)
    invoice = _resolve_invoice(db, payload)
    partner_request = _resolve_partner_request(db, payload)
    if partner_request and partner_request.entity_type == PartnerRequestEntityType.COMMISSION_REQUEST and not commission:
        commission = db.get(CommissionRequest, partner_request.entity_id)
    if partner_request and partner_request.entity_type == PartnerRequestEntityType.ASSIGNMENT and not assignment:
        assignment = db.get(Assignment, partner_request.entity_id)
    if partner_request and partner_request.entity_type == PartnerRequestEntityType.INVOICE and not invoice:
        invoice = db.get(Invoice, partner_request.entity_id)
    request_code = commission.request_code if commission else None
    assignment_code = assignment.assignment_code if assignment else None
    invoice_number = invoice.invoice_number if invoice else None

    portal_link = base_url + "/partner/requests"
    if commission:
        portal_link = f"{base_url}/partner/requests/{commission.id}"
    elif assignment:
        portal_link = f"{base_url}/partner/requests?assignment={assignment.id}"

    if notif_type == NotificationType.PARTNER_DOC_REQUESTED:
        subject = f"Documents requested for {request_code or 'your request'}"
        body = (
            f"<p>We need additional documents to proceed.</p>"
            f"<p><strong>{message}</strong></p>"
            f"<p>Request: {request_code or '—'}</p>"
            f"<p><a href=\"{portal_link}\">Upload documents in the portal</a></p>"
        )
        text = _join_text(
            "We need additional documents to proceed.",
            message,
            f"Request: {request_code or '—'}",
            f"Portal: {portal_link}",
        )
        return {"subject": subject, "html": body, "text": text}

    if notif_type == NotificationType.PARTNER_REQUEST_NEEDS_INFO:
        subject = f"More information required for {request_code or 'your request'}"
        body = (
            f"<p>We need more information to proceed.</p>"
            f"<p><strong>{message}</strong></p>"
            f"<p>Request: {request_code or '—'}</p>"
            f"<p><a href=\"{portal_link}\">Respond in the portal</a></p>"
        )
        text = _join_text(
            "We need more information to proceed.",
            message,
            f"Request: {request_code or '—'}",
            f"Portal: {portal_link}",
        )
        return {"subject": subject, "html": body, "text": text}

    if notif_type == NotificationType.PARTNER_REQUEST_APPROVED:
        subject = f"Commission approved{f' — {request_code}' if request_code else ''}"
        body = (
            f"<p>Your commission request has been approved.</p>"
            f"<p>Request: {request_code or '—'}</p>"
            f"<p>Assignment: {assignment_code or 'In progress'}</p>"
            f"<p><a href=\"{portal_link}\">View request status</a></p>"
        )
        text = _join_text(
            "Your commission request has been approved.",
            f"Request: {request_code or '—'}",
            f"Assignment: {assignment_code or 'In progress'}",
            f"Portal: {portal_link}",
        )
        return {"subject": subject, "html": body, "text": text}

    if notif_type == NotificationType.PARTNER_REQUEST_REJECTED:
        subject = f"Commission rejected{f' — {request_code}' if request_code else ''}"
        body = (
            f"<p>Your commission request was rejected.</p>"
            f"<p>{message}</p>"
            f"<p>Request: {request_code or '—'}</p>"
            f"<p><a href=\"{portal_link}\">View request</a></p>"
        )
        text = _join_text(
            "Your commission request was rejected.",
            message,
            f"Request: {request_code or '—'}",
            f"Portal: {portal_link}",
        )
        return {"subject": subject, "html": body, "text": text}

    if notif_type == NotificationType.PARTNER_PAYMENT_REQUESTED:
        subject = f"Payment requested{f' — {invoice_number}' if invoice_number else ''}"
        payments_link = base_url + "/partner/payments"
        body = (
            f"<p>A payment request has been raised for your report.</p>"
            f"<p>Invoice: {invoice_number or '—'}</p>"
            f"<p><a href=\"{payments_link}\">View invoice and upload payment proof</a></p>"
        )
        text = _join_text(
            "A payment request has been raised for your report.",
            f"Invoice: {invoice_number or '—'}",
            f"Payments: {payments_link}",
        )
        return {"subject": subject, "html": body, "text": text}

    if notif_type == NotificationType.PARTNER_PAYMENT_VERIFIED:
        subject = f"Payment confirmed{f' — {invoice_number}' if invoice_number else ''}"
        body = (
            f"<p>Payment has been verified.</p>"
            f"<p>Invoice: {invoice_number or '—'}</p>"
            f"<p><a href=\"{portal_link}\">View deliverables</a></p>"
        )
        text = _join_text(
            "Payment has been verified.",
            f"Invoice: {invoice_number or '—'}",
            f"Portal: {portal_link}",
        )
        return {"subject": subject, "html": body, "text": text}

    if notif_type == NotificationType.PARTNER_DELIVERABLE_RELEASED:
        subject = f"Final report available{f' — {assignment_code}' if assignment_code else ''}"
        body = (
            f"<p>Your final report is now available.</p>"
            f"<p>Assignment: {assignment_code or '—'}</p>"
            f"<p><a href=\"{portal_link}\">Download from the portal</a></p>"
        )
        text = _join_text(
            "Your final report is now available.",
            f"Assignment: {assignment_code or '—'}",
            f"Portal: {portal_link}",
        )
        return {"subject": subject, "html": body, "text": text}

    return None


def _build_internal_email(
    notif_type: NotificationType,
    message: str,
    payload: dict,
    base_url: str,
) -> Optional[dict]:
    if notif_type == NotificationType.APPROVAL_PENDING:
        subject = "Approval required"
        body = (
            f"<p>{message}</p>"
            f"<p><a href=\"{base_url}/admin/approvals\">Open approvals inbox</a></p>"
        )
        text = _join_text(message, f"Approvals: {base_url}/admin/approvals")
        return {"subject": subject, "html": body, "text": text}
    if notif_type == NotificationType.SLA_OVERDUE:
        subject = "Overdue assignments"
        body = (
            f"<p>{message}</p>"
            f"<p><a href=\"{base_url}/assignments?due=OVERDUE\">View overdue assignments</a></p>"
        )
        text = _join_text(message, f"Assignments: {base_url}/assignments?due=OVERDUE")
        return {"subject": subject, "html": body, "text": text}
    if notif_type == NotificationType.TASK_OVERDUE:
        subject = "Task overdue"
        body = (
            f"<p>{message}</p>"
            f"<p><a href=\"{base_url}/account\">Open My Day</a></p>"
        )
        text = _join_text(message, f"My Day: {base_url}/account")
        return {"subject": subject, "html": body, "text": text}
    if notif_type == NotificationType.PAYMENT_PENDING:
        subject = "Payment pending"
        body = (
            f"<p>{message}</p>"
            f"<p><a href=\"{base_url}/invoices?unpaid=true\">Review unpaid invoices</a></p>"
        )
        text = _join_text(message, f"Invoices: {base_url}/invoices?unpaid=true")
        return {"subject": subject, "html": body, "text": text}
    return None


def _resolve_commission(db: Session, payload: dict) -> Optional[CommissionRequest]:
    commission_id = payload.get("commission_request_id")
    if commission_id:
        return db.get(CommissionRequest, commission_id)
    return None


def _resolve_assignment(db: Session, payload: dict) -> Optional[Assignment]:
    assignment_id = payload.get("assignment_id")
    if assignment_id:
        return db.get(Assignment, assignment_id)
    return None


def _resolve_invoice(db: Session, payload: dict) -> Optional[Invoice]:
    invoice_id = payload.get("invoice_id")
    if invoice_id:
        return db.get(Invoice, invoice_id)
    return None


def _resolve_partner_request(db: Session, payload: dict) -> Optional[PartnerRequest]:
    request_id = payload.get("partner_request_id")
    if request_id:
        return db.get(PartnerRequest, request_id)
    return None


def _join_text(*parts: str) -> str:
    return "\n".join([part for part in parts if part])
