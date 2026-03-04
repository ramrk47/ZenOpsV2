from __future__ import annotations

from datetime import datetime, timezone
import itertools

import pytest
from fastapi.testclient import TestClient

import app.routers.partner_onboarding as onboarding_router
import app.services.invites as invites_service
from app.core.security import create_access_token
from app.db.session import get_db
from app.main import app
from app.models.enums import Role
from app.models.partner_account_request import PartnerAccountRequest
from app.models.user import User
from app.models.user_invite import UserInvite
from tests.postgres_utils import create_postgres_test_session


@pytest.fixture()
def env(monkeypatch):
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
    db.commit()
    db.refresh(admin)

    sent_emails = []

    def fake_email_delivery(_db, **kwargs):
        sent_emails.append(kwargs)
        return None

    def fake_notify_roles(_db, **kwargs):
        return []

    token_counter = itertools.count(1)

    def fake_token_urlsafe(_size: int):
        return f"verify-token-phase6-{next(token_counter)}"

    monkeypatch.setattr(onboarding_router, "create_email_delivery", fake_email_delivery)
    monkeypatch.setattr(onboarding_router, "notify_roles", fake_notify_roles)
    monkeypatch.setattr(onboarding_router.secrets, "token_urlsafe", fake_token_urlsafe)
    monkeypatch.setattr(invites_service.secrets, "token_urlsafe", fake_token_urlsafe)
    monkeypatch.setattr(onboarding_router.settings, "associate_onboarding_mode", "REQUEST_ACCESS_REVIEW", raising=False)
    monkeypatch.setattr(onboarding_router.settings, "associate_email_verify_required", True, raising=False)
    monkeypatch.setattr(onboarding_router.settings, "associate_auto_approve", False, raising=False)
    monkeypatch.setattr(onboarding_router.settings, "associate_auto_approve_domains", [], raising=False)
    monkeypatch.setattr(onboarding_router.settings, "associate_auto_approve_max_per_day", 99, raising=False)
    monkeypatch.setattr(onboarding_router.settings, "associate_verify_token_ttl_minutes", 15, raising=False)
    monkeypatch.setattr(onboarding_router.settings, "environment", "development", raising=False)

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    try:
        yield client, db, admin, sent_emails
    finally:
        client.close()
        db.close()
        engine.dispose()
        app.dependency_overrides.clear()


def _auth_headers(user: User) -> dict[str, str]:
    token = create_access_token({"sub": str(user.id), "role": user.role.value, "roles": user.roles or [user.role.value]})
    return {"Authorization": f"Bearer {token}"}


def test_request_access_creates_pending_record_and_sends_verification(env):
    client, db, _admin, sent_emails = env

    submitted = client.post(
        "/api/partner/request-access",
        json={
            "company_name": "BlueStone Associates",
            "contact_name": "Ravi Kumar",
            "email": "associate@example.com",
            "phone": "9999999999",
            "message": "Need access",
            "captcha_token": "",
        },
    )
    assert submitted.status_code == 201, submitted.text
    assert any(mail.get("event_type") == "ASSOCIATE_ACCESS_VERIFY" for mail in sent_emails)

    request_row = db.query(PartnerAccountRequest).filter(PartnerAccountRequest.email == "associate@example.com").first()
    assert request_row is not None
    assert request_row.status == "PENDING_EMAIL_VERIFY"
    assert request_row.email_verification_token is not None
    assert request_row.token_expires_at is not None

    verified = client.post("/api/partner/verify-access-token", json={"token": "verify-token-phase6-1"})
    assert verified.status_code == 200, verified.text
    assert verified.json()["status"] == "VERIFIED_PENDING_REVIEW"

    db.refresh(request_row)
    assert request_row.email_verified_at is not None
    assert request_row.token_consumed_at is not None
    assert request_row.email_verification_token is None

    replay = client.post("/api/partner/verify-access-token", json={"token": "verify-token-phase6-1"})
    assert replay.status_code in {400, 404}


def test_auto_approve_mode_provisions_associate_user(env, monkeypatch):
    client, db, _admin, sent_emails = env
    monkeypatch.setattr(onboarding_router.settings, "associate_onboarding_mode", "REQUEST_ACCESS_AUTO_APPROVE", raising=False)
    monkeypatch.setattr(onboarding_router.settings, "associate_auto_approve_domains", ["example.com"], raising=False)

    submitted = client.post(
        "/api/partner/request-access",
        json={
            "company_name": "AutoApprove Associates",
            "contact_name": "Rani Auto",
            "email": "auto-approve@example.com",
            "phone": "9888888888",
            "message": "Auto approve path",
            "captcha_token": "",
        },
    )
    assert submitted.status_code == 201, submitted.text
    assert any(mail.get("event_type") == "ASSOCIATE_ACCESS_VERIFY" for mail in sent_emails)

    verified = client.post("/api/partner/verify-access-token", json={"token": "verify-token-phase6-1"})
    assert verified.status_code == 200, verified.text
    assert verified.json()["status"] == "APPROVED"

    request_row = (
        db.query(PartnerAccountRequest)
        .filter(PartnerAccountRequest.email == "auto-approve@example.com")
        .first()
    )
    assert request_row is not None
    assert request_row.approved_at is not None
    assert request_row.created_user_id is not None

    user = db.query(User).filter(User.email == "auto-approve@example.com").first()
    assert user is not None
    assert user.role == Role.EXTERNAL_PARTNER
    assert user.partner_id is not None


def test_review_mode_admin_approve_sends_invite(env):
    client, db, admin, sent_emails = env

    submitted = client.post(
        "/api/partner/request-access",
        json={
            "company_name": "BlueStone Associates",
            "contact_name": "Ravi Kumar",
            "email": "associate@example.com",
            "phone": "9999999999",
            "message": "Need access",
            "captcha_token": "",
        },
    )
    assert submitted.status_code == 201, submitted.text

    verified = client.post("/api/partner/verify-access-token", json={"token": "verify-token-phase6-1"})
    assert verified.status_code == 200, verified.text
    assert verified.json()["status"] == "VERIFIED_PENDING_REVIEW"

    request_row = db.query(PartnerAccountRequest).filter(PartnerAccountRequest.email == "associate@example.com").first()
    assert request_row is not None

    approved = client.post(
        f"/api/admin/associate-access-requests/{request_row.id}/approve",
        headers=_auth_headers(admin),
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "APPROVED"
    assert any(mail.get("event_type") == "ASSOCIATE_ACCESS_INVITE" for mail in sent_emails)

    invite = db.query(UserInvite).filter(UserInvite.email == "associate@example.com").first()
    assert invite is not None
    assert invite.used_at is None
    expires_at = invite.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    assert expires_at > datetime.now(timezone.utc)


def test_associate_cannot_access_admin_endpoints(env):
    client, db, _admin, _sent_emails = env

    associate = User(
        email="existing-associate@example.com",
        hashed_password="x",
        role=Role.EXTERNAL_PARTNER,
        roles=[Role.EXTERNAL_PARTNER.value],
        full_name="External Associate",
        is_active=True,
    )
    db.add(associate)
    db.commit()
    db.refresh(associate)

    blocked = client.get("/api/admin/associate-access-requests", headers=_auth_headers(associate))
    assert blocked.status_code == 403
