from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
import hashlib
import json
import logging
import time
from typing import Any, Optional
from uuid import UUID

import httpx

from app.core.settings import settings
from app.models.invoice import Invoice, InvoicePayment

logger = logging.getLogger(__name__)


def _is_uuid(value: str) -> bool:
    try:
        UUID(value)
        return True
    except (ValueError, TypeError):
        return False


def _as_iso(value: date | datetime | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return value.isoformat()


def _as_money(value: Decimal | None) -> str:
    return str(value or Decimal("0.00"))


def _base_url() -> str:
    base = (settings.studio_base_url or "").strip().rstrip("/")
    if base.endswith("/v1"):
        return base[:-3]
    return base


def resolve_invoice_account_key(invoice: Invoice) -> str:
    # Strategy: prefer partner mapping for commissioned work; otherwise fallback to stable entity keys.
    if invoice.partner_id:
        return f"v1:partner:{invoice.partner_id}"
    if invoice.client_id:
        return f"v1:client:{invoice.client_id}"
    if invoice.assignment_id:
        return f"v1:assignment:{invoice.assignment_id}"
    return f"v1:invoice:{invoice.id}"


def resolve_assignment_account_key(*, assignment_id: int, partner_id: int | None = None) -> str:
    if partner_id:
        return f"v1:partner:{partner_id}"
    return f"v1:assignment:{assignment_id}"


def normalize_external_key(entity_type: str, entity_id: int | str) -> str:
    raw_type = (entity_type or "").strip().lower()
    if raw_type in {"external_associate", "referral_channel", "partner"}:
        return f"v1:partner:{entity_id}"
    if raw_type in {"channel"}:
        return f"v1:channel:{entity_id}"
    if raw_type in {"client"}:
        return f"v1:client:{entity_id}"
    if raw_type in {"assignment"}:
        return f"v1:assignment:{entity_id}"
    if raw_type in {"invoice"}:
        return f"v1:invoice:{entity_id}"
    return f"v1:{raw_type or 'entity'}:{entity_id}"


def parse_external_key(external_key: str) -> tuple[str, int | None]:
    parts = (external_key or "").strip().split(":")
    if len(parts) < 3 or parts[0] != "v1":
        return "", None
    entity_type = parts[1]
    try:
        return entity_type, int(parts[2])
    except ValueError:
        return entity_type, None


def _invoice_event_idempotency_key(event_type: str, invoice: Invoice, *, payment_id: int | None = None) -> str:
    fingerprint = "|".join(
        [
            "v1",
            event_type,
            str(invoice.id),
            str(payment_id or 0),
            str(invoice.status),
            _as_iso(invoice.updated_at) or "",
            _as_money(invoice.amount_due),
        ]
    )
    digest = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()[:16]
    return f"v1:{event_type}:{invoice.id}:{payment_id or 0}:{digest}"


class StudioBillingAdapter:
    def __init__(self) -> None:
        self.timeout_seconds = max(float(settings.studio_http_timeout_seconds or 5.0), 0.5)
        self.status_cache_ttl_seconds = max(int(settings.studio_status_cache_seconds or 45), 1)
        self._status_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._status_last_success: dict[str, dict[str, Any]] = {}
        self._collection_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
        self._collection_last_success: dict[str, tuple[float, list[dict[str, Any]]]] = {}
        self._meta_cache: tuple[float, dict[str, Any]] | None = None
        self._last_ok_epoch: float | None = None
        self._last_error: str | None = None

    @property
    def enabled(self) -> bool:
        return bool(_base_url() and settings.studio_service_token)

    def _headers(self) -> dict[str, str]:
        return {
            "x-service-token": settings.studio_service_token or "",
            "content-type": "application/json",
        }

    def _record_success(self) -> None:
        self._last_ok_epoch = time.time()
        self._last_error = None

    def _capture_error(self, message: str) -> None:
        self._last_error = message

    def _cache_hit(
        self,
        cache: dict[str, tuple[float, Any]],
        key: str,
        *,
        force_refresh: bool = False,
    ) -> Any | None:
        if force_refresh:
            return None
        entry = cache.get(key)
        if not entry:
            return None
        expires_at, payload = entry
        if expires_at <= time.monotonic():
            return None
        return payload

    def health_snapshot(self) -> dict[str, Any]:
        cache_age: int | None = None
        if self._last_ok_epoch:
            cache_age = max(int(time.time() - self._last_ok_epoch), 0)
        return {
            "base_url": _base_url(),
            "enabled": self.enabled,
            "last_ok_at": datetime.fromtimestamp(self._last_ok_epoch, tz=timezone.utc).isoformat()
            if self._last_ok_epoch
            else None,
            "cache_age_seconds": cache_age,
            "cache_ttl_seconds": self.status_cache_ttl_seconds,
            "last_error": self._last_error,
        }

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: Optional[dict[str, Any]] = None,
        params: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any] | None:
        if not self.enabled:
            return None
        url = f"{_base_url()}{path}"
        try:
            with httpx.Client(timeout=self.timeout_seconds) as client:
                response = client.request(
                    method=method,
                    url=url,
                    headers=self._headers(),
                    json=body,
                    params=params,
                )
            if response.status_code >= 400:
                self._capture_error(f"{method} {path} -> HTTP {response.status_code}")
                logger.warning(
                    "studio_billing_request_failed status=%s path=%s body=%s",
                    response.status_code,
                    path,
                    json.dumps(body or {}, default=str),
                )
                return None
            if not response.content:
                self._record_success()
                return {}
            payload = response.json()
            self._record_success()
            return payload
        except Exception as exc:  # noqa: BLE001
            self._capture_error(f"{method} {path} -> {exc}")
            logger.warning("studio_billing_request_error path=%s error=%s", path, exc)
            return None

    def _resolve_status_envelope(self, account_key: str, *, force_refresh: bool = False) -> dict[str, Any]:
        key = (account_key or "").strip()
        if not key:
            return {
                "reachable": False,
                "stale": False,
                "error": "missing_account_key",
                "fetched_at": None,
                "status": self._fallback_status(),
            }

        now = time.monotonic()
        cached = self._cache_hit(self._status_cache, key, force_refresh=force_refresh)
        if cached is not None:
            last = self._status_last_success.get(key)
            return {
                "reachable": True,
                "stale": False,
                "error": None,
                "fetched_at": last.get("fetched_at") if last else None,
                "status": dict(cached),
            }

        if _is_uuid(key):
            response = self._request("GET", f"/v1/billing/accounts/{key}/status")
        else:
            response = self._request(
                "GET",
                "/v1/billing/accounts/status",
                params={"external_key": key},
            )

        if response:
            normalized = self._normalize_status(response)
            self._status_cache[key] = (now + self.status_cache_ttl_seconds, normalized)
            fetched_at = datetime.now(timezone.utc).isoformat()
            self._status_last_success[key] = {"fetched_at": fetched_at, "status": normalized}
            return {
                "reachable": True,
                "stale": False,
                "error": None,
                "fetched_at": fetched_at,
                "status": normalized,
            }

        stale = self._status_last_success.get(key)
        if stale:
            return {
                "reachable": False,
                "stale": True,
                "error": self._last_error or "studio_unreachable",
                "fetched_at": stale.get("fetched_at"),
                "status": dict(stale.get("status", {})),
            }
        return {
            "reachable": False,
            "stale": False,
            "error": self._last_error or "studio_unreachable",
            "fetched_at": None,
            "status": self._fallback_status(),
        }

    def get_billing_status(self, account_key: str, *, force_refresh: bool = False) -> dict[str, Any]:
        return self._resolve_status_envelope(account_key, force_refresh=force_refresh)["status"]

    def get_status_by_external_key(self, external_key: str, *, force_refresh: bool = False) -> dict[str, Any]:
        envelope = self._resolve_status_envelope(external_key, force_refresh=force_refresh)
        return {
            "external_key": (external_key or "").strip(),
            **envelope,
        }

    def get_studio_meta(self, *, force_refresh: bool = False) -> dict[str, Any]:
        now = time.monotonic()
        if self._meta_cache and not force_refresh and self._meta_cache[0] > now:
            return {
                "reachable": True,
                "meta": self._meta_cache[1],
                "error": None,
            }
        response = self._request("GET", "/v1/meta")
        if isinstance(response, dict) and response:
            self._meta_cache = (now + self.status_cache_ttl_seconds, response)
            return {"reachable": True, "meta": response, "error": None}
        cached_meta = self._meta_cache[1] if self._meta_cache else None
        return {
            "reachable": False,
            "meta": cached_meta,
            "error": self._last_error or "studio_unreachable",
        }

    def get_reservations(
        self,
        *,
        external_key: str | None = None,
        account_id: str | None = None,
        limit: int = 30,
        force_refresh: bool = False,
    ) -> dict[str, Any]:
        return self._fetch_collection(
            name="reservations",
            path="/v1/billing/credits/reservations",
            external_key=external_key,
            account_id=account_id,
            limit=limit,
            force_refresh=force_refresh,
        )

    def get_ledger(
        self,
        *,
        external_key: str | None = None,
        account_id: str | None = None,
        limit: int = 30,
        force_refresh: bool = False,
    ) -> dict[str, Any]:
        return self._fetch_collection(
            name="ledger",
            path="/v1/billing/credits/ledger",
            external_key=external_key,
            account_id=account_id,
            limit=limit,
            force_refresh=force_refresh,
        )

    def get_timeline(
        self,
        *,
        external_key: str | None = None,
        account_id: str | None = None,
        limit: int = 30,
        force_refresh: bool = False,
    ) -> dict[str, Any]:
        return self._fetch_collection(
            name="timeline",
            path="/v1/billing/timeline",
            external_key=external_key,
            account_id=account_id,
            limit=limit,
            force_refresh=force_refresh,
        )

    def _fetch_collection(
        self,
        *,
        name: str,
        path: str,
        external_key: str | None,
        account_id: str | None,
        limit: int,
        force_refresh: bool,
    ) -> dict[str, Any]:
        cache_key = f"{name}:{account_id or external_key or '-'}:{limit}"
        cached = self._cache_hit(self._collection_cache, cache_key, force_refresh=force_refresh)
        if cached is not None:
            return {"reachable": True, "stale": False, "error": None, "rows": cached}

        params: dict[str, Any] = {"limit": max(int(limit), 1)}
        if account_id:
            params["account_id"] = account_id
        if external_key:
            params["external_key"] = external_key
        response = self._request("GET", path, params=params)
        rows = self._extract_rows(response)

        if rows is not None:
            expires_at = time.monotonic() + self.status_cache_ttl_seconds
            self._collection_cache[cache_key] = (expires_at, rows)
            self._collection_last_success[cache_key] = (time.time(), rows)
            return {"reachable": True, "stale": False, "error": None, "rows": rows}

        stale = self._collection_last_success.get(cache_key)
        if stale:
            return {
                "reachable": False,
                "stale": True,
                "error": self._last_error or "studio_unreachable",
                "rows": stale[1],
            }
        return {"reachable": False, "stale": False, "error": self._last_error or "studio_unreachable", "rows": []}

    def _extract_rows(self, response: Any) -> list[dict[str, Any]] | None:
        if isinstance(response, list):
            return [row for row in response if isinstance(row, dict)]
        if not isinstance(response, dict):
            return None
        for key in ("rows", "items", "events", "reservations", "ledger", "timeline", "data"):
            candidate = response.get(key)
            if isinstance(candidate, list):
                return [row for row in candidate if isinstance(row, dict)]
        return None

    def _normalize_status(self, payload: dict[str, Any]) -> dict[str, Any]:
        status = dict(payload)
        mode = str(status.get("billing_mode") or settings.default_billing_mode).upper()
        status["billing_mode"] = mode
        status.setdefault("credit", {"wallet": 0, "reserved": 0, "available": 0})
        status.setdefault("account_status", "ACTIVE")
        status.setdefault("payment_terms_days", 15)
        return status

    def reserve_credits(
        self,
        *,
        ref_type: str,
        ref_id: str,
        idempotency_key: str,
        amount: int = 1,
        account_id: str | None = None,
        external_key: str | None = None,
    ) -> dict[str, Any] | None:
        payload: dict[str, Any] = {
            "ref_type": ref_type,
            "ref_id": ref_id,
            "idempotency_key": idempotency_key,
            "amount": amount,
        }
        if account_id:
            payload["account_id"] = account_id
        if external_key:
            payload["external_key"] = external_key
        result = self._request("POST", "/v1/billing/credits/reserve", body=payload)
        if external_key:
            self._status_cache.pop(external_key, None)
        return result

    def consume_credits(
        self,
        *,
        ref_type: str,
        ref_id: str,
        idempotency_key: str,
        account_id: str | None = None,
        external_key: str | None = None,
        reservation_id: str | None = None,
    ) -> dict[str, Any] | None:
        payload: dict[str, Any] = {
            "ref_type": ref_type,
            "ref_id": ref_id,
            "idempotency_key": idempotency_key,
        }
        if account_id:
            payload["account_id"] = account_id
        if external_key:
            payload["external_key"] = external_key
        if reservation_id:
            payload["reservation_id"] = reservation_id
        result = self._request("POST", "/v1/billing/credits/consume", body=payload)
        if external_key:
            self._status_cache.pop(external_key, None)
        return result

    def release_credits(
        self,
        *,
        ref_type: str,
        ref_id: str,
        idempotency_key: str,
        account_id: str | None = None,
        external_key: str | None = None,
        reservation_id: str | None = None,
    ) -> dict[str, Any] | None:
        payload: dict[str, Any] = {
            "ref_type": ref_type,
            "ref_id": ref_id,
            "idempotency_key": idempotency_key,
        }
        if account_id:
            payload["account_id"] = account_id
        if external_key:
            payload["external_key"] = external_key
        if reservation_id:
            payload["reservation_id"] = reservation_id
        result = self._request("POST", "/v1/billing/credits/release", body=payload)
        if external_key:
            self._status_cache.pop(external_key, None)
        return result

    def emit_event(
        self,
        *,
        event_type: str,
        idempotency_key: str,
        account_id: str | None = None,
        external_account_key: str | None = None,
        payload: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any] | None:
        body: dict[str, Any] = {
            "source_system": "v1",
            "event_type": event_type,
            "idempotency_key": idempotency_key,
            "payload_json": payload or {},
        }
        if account_id:
            body["account_id"] = account_id
        if external_account_key:
            body["external_account_key"] = external_account_key
        return self._request("POST", "/v1/billing/events", body=body)

    def _fallback_status(self) -> dict[str, Any]:
        return {
            "billing_mode": settings.default_billing_mode.upper(),
            "account_status": "ACTIVE",
            "payment_terms_days": 15,
            "credit": {"wallet": 0, "reserved": 0, "available": 0},
            "source": "v1_default",
        }


studio_billing_adapter = StudioBillingAdapter()


def emit_invoice_event(
    event_type: str,
    invoice: Invoice,
    *,
    payment: InvoicePayment | None = None,
    extra_payload: Optional[dict[str, Any]] = None,
) -> None:
    payload: dict[str, Any] = {
        "invoice_id": invoice.id,
        "invoice_number": invoice.invoice_number,
        "assignment_id": invoice.assignment_id,
        "partner_id": invoice.partner_id,
        "client_id": invoice.client_id,
        "status": str(invoice.status),
        "currency": invoice.currency,
        "issued_date": _as_iso(invoice.issued_date),
        "due_date": _as_iso(invoice.due_date),
        "sent_at": _as_iso(invoice.sent_at),
        "paid_at": _as_iso(invoice.paid_at),
        "total_amount": _as_money(invoice.total_amount),
        "amount_paid": _as_money(invoice.amount_paid),
        "amount_due": _as_money(invoice.amount_due),
        "amount_credited": _as_money(invoice.amount_credited),
        "event_emitted_at": datetime.now(timezone.utc).isoformat(),
    }
    if payment:
        payload["payment"] = {
            "payment_id": payment.id,
            "paid_at": _as_iso(payment.paid_at),
            "amount": _as_money(payment.amount),
            "mode": str(payment.mode),
            "reference_no": payment.reference_no,
        }
    if extra_payload:
        payload.update(extra_payload)

    studio_billing_adapter.emit_event(
        event_type=event_type,
        external_account_key=resolve_invoice_account_key(invoice),
        idempotency_key=_invoice_event_idempotency_key(
            event_type, invoice, payment_id=payment.id if payment else None
        ),
        payload=payload,
    )
