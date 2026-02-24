from __future__ import annotations

import time

from app.core.settings import settings
from app.services.studio_billing import (
    StudioBillingAdapter,
    normalize_external_key,
    parse_external_key,
)


def _status_payload(mode: str = "CREDIT") -> dict:
    return {
        "billing_mode": mode,
        "account_status": "ACTIVE",
        "payment_terms_days": 15,
        "credit": {"wallet": 5, "reserved": 1, "available": 4},
    }


def test_external_key_normalization_roundtrip():
    key = normalize_external_key("external_associate", 77)
    entity_type, entity_id = parse_external_key(key)
    assert key == "v1:partner:77"
    assert entity_type == "partner"
    assert entity_id == 77


def test_status_cache_ttl_behavior(monkeypatch):
    monkeypatch.setattr(settings, "studio_base_url", "https://studio.example.com")
    monkeypatch.setattr(settings, "studio_service_token", "token")
    monkeypatch.setattr(settings, "studio_status_cache_seconds", 45)
    adapter = StudioBillingAdapter()

    calls = {"count": 0}

    def fake_request(method, path, *, body=None, params=None):  # noqa: ANN001
        calls["count"] += 1
        return _status_payload()

    monkeypatch.setattr(adapter, "_request", fake_request)

    first = adapter.get_status_by_external_key("v1:partner:101")
    second = adapter.get_status_by_external_key("v1:partner:101")
    assert first["reachable"] is True
    assert second["reachable"] is True
    assert calls["count"] == 1

    cached_status = adapter._status_cache["v1:partner:101"][1]
    adapter._status_cache["v1:partner:101"] = (time.monotonic() - 1, cached_status)

    third = adapter.get_status_by_external_key("v1:partner:101")
    assert third["reachable"] is True
    assert calls["count"] == 2


def test_fail_open_returns_stale_then_default(monkeypatch):
    monkeypatch.setattr(settings, "studio_base_url", "https://studio.example.com")
    monkeypatch.setattr(settings, "studio_service_token", "token")
    monkeypatch.setattr(settings, "default_billing_mode", "POSTPAID")
    adapter = StudioBillingAdapter()

    responses = [_status_payload(mode="CREDIT"), None, None]

    def fake_request(method, path, *, body=None, params=None):  # noqa: ANN001
        if responses:
            return responses.pop(0)
        return None

    monkeypatch.setattr(adapter, "_request", fake_request)

    ok = adapter.get_status_by_external_key("v1:partner:7")
    assert ok["reachable"] is True
    assert ok["status"]["billing_mode"] == "CREDIT"

    stale = adapter.get_status_by_external_key("v1:partner:7", force_refresh=True)
    assert stale["reachable"] is False
    assert stale["stale"] is True
    assert stale["status"]["billing_mode"] == "CREDIT"

    fallback = adapter.get_status_by_external_key("v1:partner:8", force_refresh=True)
    assert fallback["reachable"] is False
    assert fallback["stale"] is False
    assert fallback["status"]["billing_mode"] == "POSTPAID"
    assert "v1:partner:8" not in adapter._status_cache
