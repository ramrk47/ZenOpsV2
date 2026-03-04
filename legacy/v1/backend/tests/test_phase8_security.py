from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from app.core.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.assignment import Assignment
from app.models.enums import AssignmentStatus, CaseType, Role, ServiceLine
from app.models.rate_limit_bucket import RateLimitBucket
from app.models.user import User
from app.services.rate_limit import consume_rate_limit
from tests.postgres_utils import create_postgres_test_session


@pytest.fixture()
def security_env():
    engine, TestingSessionLocal = create_postgres_test_session()
    db = TestingSessionLocal()

    admin = User(
        email="admin@example.com",
        hashed_password="x",
        role=Role.ADMIN,
        roles=[Role.ADMIN.value],
        full_name="Admin",
        is_active=True,
    )
    db.add(admin)
    db.flush()

    assignment = Assignment(
        assignment_code="SEC-ASSIGN-001",
        case_type=CaseType.DIRECT_CLIENT,
        service_line=ServiceLine.VALUATION,
        borrower_name="Security Test",
        status=AssignmentStatus.PENDING,
        created_by_user_id=admin.id,
        assigned_to_user_id=admin.id,
    )
    db.add(assignment)
    db.commit()
    db.refresh(admin)
    db.refresh(assignment)

    auth_state = {"user": admin}

    def override_get_db():
        try:
            yield db
        finally:
            pass

    def override_get_current_user():
        return auth_state["user"]

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    client = TestClient(app)
    try:
        yield client, db, assignment
    finally:
        client.close()
        db.close()
        engine.dispose()
        app.dependency_overrides.clear()


def test_prod_cors_blocks_unknown_origin(security_env, monkeypatch):
    client, _db, _assignment = security_env
    monkeypatch.setattr(main_module, "is_production", True, raising=False)
    monkeypatch.setattr(main_module, "allow_origin_regex", None, raising=False)
    monkeypatch.setattr(main_module, "allowed_origin_set", {"https://portal.example.com"}, raising=False)

    response = client.get("/version", headers={"Origin": "https://evil.example.com"})
    assert response.status_code == 403, response.text
    detail = response.json().get("detail") or {}
    assert detail.get("code") == "ORIGIN_NOT_ALLOWED"


def test_rate_limit_counters_increment_and_block(security_env):
    _client, db, _assignment = security_env
    key = "login:ip:203.0.113.10"

    first = consume_rate_limit(db, key=key, limit=2, window_seconds=60)
    second = consume_rate_limit(db, key=key, limit=2, window_seconds=60)
    third = consume_rate_limit(db, key=key, limit=2, window_seconds=60)

    assert first.allowed is True
    assert second.allowed is True
    assert third.allowed is False
    assert third.count == 3

    bucket = db.get(RateLimitBucket, key)
    assert bucket is not None
    assert bucket.count == 3


def test_upload_validation_rejects_bad_extension_and_content_type(security_env):
    client, _db, assignment = security_env

    bad_extension = client.post(
        f"/api/assignments/{assignment.id}/documents/upload",
        files={"file": ("report.pdf.exe", b"fake-binary", "application/pdf")},
        data={"category": "Draft Report"},
    )
    assert bad_extension.status_code == 400, bad_extension.text
    detail = bad_extension.json().get("detail") or {}
    assert detail.get("code") in {"UPLOAD_EXTENSION_NOT_ALLOWED", "UPLOAD_DOUBLE_EXTENSION_BLOCKED"}

    bad_content_type = client.post(
        f"/api/assignments/{assignment.id}/documents/upload",
        files={"file": ("report.pdf", b"%PDF-1.4", "application/x-msdownload")},
        data={"category": "Draft Report"},
    )
    assert bad_content_type.status_code == 400, bad_content_type.text
    detail2 = bad_content_type.json().get("detail") or {}
    assert detail2.get("code") == "UPLOAD_CONTENT_TYPE_NOT_ALLOWED"
