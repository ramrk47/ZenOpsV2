from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from urllib.parse import unquote
import time

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core import rbac
from app.core.deps import get_current_user
from app.core.settings import settings
from app.db.session import get_db
from app.models.enums import Role
from app.models.invoice import Invoice, InvoicePayment
from app.models.master import Client
from app.models.partner import ExternalPartner
from app.models.user import User
from app.services.studio_billing import normalize_external_key, parse_external_key, studio_billing_adapter

router = APIRouter(prefix="/v1/admin/billing-monitor", tags=["billing-monitor"])

REFRESH_MIN_INTERVAL_SECONDS = 5
_refresh_guard: dict[int, float] = {}


def _require_admin(user: User) -> None:
    if not rbac.user_has_role(user, Role.ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")


def _to_iso(value: date | datetime | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return value.isoformat()


def _to_float(value: Decimal | None) -> float:
    return float(value or Decimal("0.00"))


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _counterparty_label(invoice: Invoice) -> str:
    if invoice.partner and invoice.partner.display_name:
        return invoice.partner.display_name
    if invoice.client and invoice.client.name:
        return invoice.client.name
    if invoice.bill_to_name:
        return invoice.bill_to_name
    if invoice.assignment and invoice.assignment.assignment_code:
        return invoice.assignment.assignment_code
    return "—"


def _invoice_row(invoice: Invoice) -> dict[str, Any]:
    return {
        "invoice_id": invoice.id,
        "invoice_no": invoice.invoice_number,
        "counterparty": _counterparty_label(invoice),
        "amount": _to_float(invoice.total_amount),
        "currency": invoice.currency,
        "status": str(invoice.status),
        "due_date": _to_iso(invoice.due_date),
        "paid_date": _to_iso(invoice.paid_at),
        "issued_date": _to_iso(invoice.issued_date),
        "external_key": normalize_external_key("partner", invoice.partner_id)
        if invoice.partner_id
        else normalize_external_key("client", invoice.client_id)
        if invoice.client_id
        else normalize_external_key("assignment", invoice.assignment_id),
    }


def _payment_row(payment: InvoicePayment) -> dict[str, Any]:
    invoice = payment.invoice
    return {
        "payment_id": payment.id,
        "method": str(payment.mode),
        "amount": _to_float(payment.amount),
        "reference": payment.reference_no,
        "paid_at": _to_iso(payment.paid_at),
        "invoice_id": invoice.id if invoice else None,
        "invoice_no": invoice.invoice_number if invoice else None,
        "counterparty": _counterparty_label(invoice) if invoice else "—",
        "external_key": normalize_external_key("partner", invoice.partner_id)
        if invoice and invoice.partner_id
        else normalize_external_key("client", invoice.client_id)
        if invoice and invoice.client_id
        else normalize_external_key("assignment", invoice.assignment_id)
        if invoice
        else None,
    }


def _extract_last_timestamp(rows: list[dict[str, Any]]) -> str | None:
    if not rows:
        return None
    row = rows[0]
    for key in ("timestamp", "created_at", "updated_at", "occurred_at"):
        value = row.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _enforce_refresh_limit(user: User, force_refresh: bool) -> None:
    if not force_refresh:
        return
    now = time.monotonic()
    last = _refresh_guard.get(user.id, 0.0)
    if now - last < REFRESH_MIN_INTERVAL_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Refresh rate limited. Try again in {REFRESH_MIN_INTERVAL_SECONDS} seconds.",
        )
    _refresh_guard[user.id] = now


def _scope_invoice_query(query, entity_type: str, entity_id: int | None):
    if entity_id is None:
        return query.filter(Invoice.id == -1)
    if entity_type in {"partner", "channel"}:
        return query.filter(Invoice.partner_id == entity_id)
    if entity_type == "client":
        return query.filter(Invoice.client_id == entity_id)
    if entity_type == "assignment":
        return query.filter(Invoice.assignment_id == entity_id)
    return query.filter(Invoice.id == -1)


def _scope_payment_query(query, entity_type: str, entity_id: int | None):
    if entity_id is None:
        return query.filter(InvoicePayment.id == -1)
    if entity_type in {"partner", "channel"}:
        return query.join(InvoicePayment.invoice).filter(Invoice.partner_id == entity_id)
    if entity_type == "client":
        return query.join(InvoicePayment.invoice).filter(Invoice.client_id == entity_id)
    if entity_type == "assignment":
        return query.join(InvoicePayment.invoice).filter(Invoice.assignment_id == entity_id)
    return query.filter(InvoicePayment.id == -1)


def _account_warning(status_envelope: dict[str, Any], billing_mode: str, available: int) -> list[str]:
    warnings: list[str] = []
    error = str(status_envelope.get("error") or "")
    if billing_mode == "CREDIT" and available <= 0:
        warnings.append("insufficient_credits")
    if not status_envelope.get("reachable"):
        warnings.append("studio_unreachable")
    if status_envelope.get("stale"):
        warnings.append("studio_cached")
    if "HTTP 404" in error:
        warnings.append("not_enrolled")
    return warnings


def _load_accounts(db: Session) -> list[tuple[str, int, str]]:
    rows: list[tuple[str, int, str]] = []
    partners = (
        db.query(ExternalPartner)
        .filter(ExternalPartner.is_active.is_(True))
        .order_by(ExternalPartner.display_name.asc(), ExternalPartner.id.asc())
        .all()
    )
    clients = (
        db.query(Client)
        .filter(Client.is_active.is_(True))
        .order_by(Client.name.asc(), Client.id.asc())
        .all()
    )
    rows.extend(("referral_channel", partner.id, partner.display_name) for partner in partners)
    rows.extend(("client", client.id, client.name) for client in clients)
    return rows


def _build_account_summary_rows(db: Session, *, force_refresh: bool) -> list[dict[str, Any]]:
    accounts: list[dict[str, Any]] = []
    for entity_type, entity_id, display_name in _load_accounts(db):
        external_key = normalize_external_key(entity_type, entity_id)
        status_envelope = studio_billing_adapter.get_status_by_external_key(
            external_key,
            force_refresh=force_refresh,
        )
        status_payload = status_envelope.get("status", {})
        billing_mode = str(status_payload.get("billing_mode") or settings.default_billing_mode).upper()
        credit = status_payload.get("credit") if isinstance(status_payload.get("credit"), dict) else {}
        wallet = _to_int(credit.get("wallet") or credit.get("total"))
        reserved = _to_int(credit.get("reserved"))
        available = _to_int(credit.get("available"), wallet - reserved)
        timeline = studio_billing_adapter.get_timeline(
            external_key=external_key,
            account_id=status_payload.get("account_id"),
            limit=1,
            force_refresh=force_refresh,
        )
        accounts.append(
            {
                "entity_type": entity_type,
                "entity_id": entity_id,
                "display_name": display_name,
                "external_key": external_key,
                "billing_mode": billing_mode,
                "account_status": str(status_payload.get("account_status") or "ACTIVE").upper(),
                "credit": {
                    "wallet": wallet,
                    "reserved": reserved,
                    "available": available,
                },
                "warnings": _account_warning(status_envelope, billing_mode, available),
                "last_event_at": _extract_last_timestamp(timeline.get("rows", [])),
                "studio_reachable": bool(status_envelope.get("reachable")),
                "studio_status_error": status_envelope.get("error"),
            }
        )
    return accounts


def _recent_invoices(db: Session, *, limit: int = 30) -> list[dict[str, Any]]:
    rows = (
        db.query(Invoice)
        .options(selectinload(Invoice.partner), selectinload(Invoice.client), selectinload(Invoice.assignment))
        .order_by(Invoice.updated_at.desc())
        .limit(limit)
        .all()
    )
    return [_invoice_row(row) for row in rows]


def _recent_payments(db: Session, *, limit: int = 30) -> list[dict[str, Any]]:
    rows = (
        db.query(InvoicePayment)
        .options(joinedload(InvoicePayment.invoice).joinedload(Invoice.partner))
        .options(joinedload(InvoicePayment.invoice).joinedload(Invoice.client))
        .order_by(InvoicePayment.paid_at.desc(), InvoicePayment.id.desc())
        .limit(limit)
        .all()
    )
    return [_payment_row(row) for row in rows]


@router.get("/summary")
def billing_monitor_summary(
    refresh: bool = Query(False, description="Force cache refresh for this request"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _require_admin(current_user)
    _enforce_refresh_limit(current_user, refresh)

    studio_meta = studio_billing_adapter.get_studio_meta(force_refresh=refresh)
    accounts = _build_account_summary_rows(db, force_refresh=refresh)
    health = studio_billing_adapter.health_snapshot()

    return {
        "v1_meta": {
            "app": "zenops-v1",
            "version": settings.project_version,
            "environment": settings.environment,
            "default_billing_mode": settings.default_billing_mode.upper(),
        },
        "studio": {
            "base_url": health.get("base_url"),
            "reachable": bool(studio_meta.get("reachable")),
            "studio_meta": studio_meta.get("meta"),
            "last_ok_at": health.get("last_ok_at"),
            "cache_age_seconds": health.get("cache_age_seconds"),
            "cache_ttl_seconds": health.get("cache_ttl_seconds"),
            "error": studio_meta.get("error") or health.get("last_error"),
            "show_cached_banner": not bool(studio_meta.get("reachable")) and bool(health.get("last_ok_at")),
            "reconcile_endpoint": "/v1/billing/credits/reconcile",
        },
        "accounts": accounts,
        "v1_invoices": _recent_invoices(db, limit=30),
        "v1_payments": _recent_payments(db, limit=30),
    }


@router.get("/account/{external_key:path}")
def billing_monitor_account_detail(
    external_key: str,
    refresh: bool = Query(False, description="Force cache refresh for this request"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _require_admin(current_user)
    _enforce_refresh_limit(current_user, refresh)

    decoded_key = unquote(external_key).strip()
    if not decoded_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="external_key is required")

    status_envelope = studio_billing_adapter.get_status_by_external_key(decoded_key, force_refresh=refresh)
    status_payload = status_envelope.get("status", {})
    account_id = status_payload.get("account_id")
    reservations = studio_billing_adapter.get_reservations(
        external_key=decoded_key,
        account_id=account_id,
        limit=50,
        force_refresh=refresh,
    )
    ledger = studio_billing_adapter.get_ledger(
        external_key=decoded_key,
        account_id=account_id,
        limit=50,
        force_refresh=refresh,
    )
    timeline = studio_billing_adapter.get_timeline(
        external_key=decoded_key,
        account_id=account_id,
        limit=50,
        force_refresh=refresh,
    )

    entity_type, entity_id = parse_external_key(decoded_key)
    invoices_query = (
        db.query(Invoice)
        .options(selectinload(Invoice.partner), selectinload(Invoice.client), selectinload(Invoice.assignment))
        .order_by(Invoice.updated_at.desc())
    )
    payments_query = (
        db.query(InvoicePayment)
        .options(joinedload(InvoicePayment.invoice).joinedload(Invoice.partner))
        .options(joinedload(InvoicePayment.invoice).joinedload(Invoice.client))
        .order_by(InvoicePayment.paid_at.desc(), InvoicePayment.id.desc())
    )
    scoped_invoices = _scope_invoice_query(invoices_query, entity_type, entity_id).limit(30).all()
    scoped_payments = _scope_payment_query(payments_query, entity_type, entity_id).limit(30).all()

    return {
        "external_key": decoded_key,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "studio_status": status_envelope,
        "reservations": reservations.get("rows", []),
        "ledger": ledger.get("rows", []),
        "timeline": timeline.get("rows", []),
        "v1_invoices": [_invoice_row(row) for row in scoped_invoices],
        "v1_payments": [_payment_row(row) for row in scoped_payments],
        "studio_collection_status": {
            "reservations": {
                "reachable": reservations.get("reachable"),
                "stale": reservations.get("stale"),
                "error": reservations.get("error"),
            },
            "ledger": {
                "reachable": ledger.get("reachable"),
                "stale": ledger.get("stale"),
                "error": ledger.get("error"),
            },
            "timeline": {
                "reachable": timeline.get("reachable"),
                "stale": timeline.get("stale"),
                "error": timeline.get("error"),
            },
        },
        "raw_json": {
            "status": status_envelope,
            "reservations": reservations.get("rows", []),
            "ledger": ledger.get("rows", []),
            "timeline": timeline.get("rows", []),
        },
    }
