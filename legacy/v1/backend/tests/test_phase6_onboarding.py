from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.routers.partner_onboarding as onboarding_router
import app.services.invites as invites_service
from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.enums import Role
from app.models.partner_account_request import PartnerAccountRequest
from app.models.user import User
from app.models.user_invite import UserInvite


@pytest.fixture()
def env(monkeypatch):
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)
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

    token_values = iter(["verify-token-phase6", "invite-token-phase6"])

    def fake_token_urlsafe(_size: int):
        return next(token_values)

    monkeypatch.setattr(onboarding_router, "create_email_delivery", fake_email_delivery)
    monkeypatch.setattr(onboarding_router.secrets, "token_urlsafe", fake_token_urlsafe)
    monkeypatch.setattr(invites_service.secrets, "token_urlsafe", fake_token_urlsafe)

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
        app.dependency_overrides.clear()


def _auth_headers(user: User) -> dict[str, str]:
    token = create_access_token({"sub": str(user.id), "role": user.role.value, "roles": user.roles or [user.role.value]})
    return {"Authorization": f"Bearer {token}"}


def test_request_verify_approve_invite_accept_and_replay_protection(env):
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
    assert any(mail.get("event_type") == "ASSOCIATE_ACCESS_VERIFY" for mail in sent_emails)

    request_row = db.query(PartnerAccountRequest).filter(PartnerAccountRequest.email == "associate@example.com").first()
    assert request_row is not None
    assert request_row.status == "PENDING"
    assert request_row.email_verification_token is not None

    verified = client.post("/api/partner/verify", json={"token": "verify-token-phase6"})
    assert verified.status_code == 200, verified.text
    assert verified.json()["status"] == "VERIFIED"

    db.refresh(request_row)
    assert request_row.email_verified_at is not None

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
    assert expires_at > datetime.now(timezone.utc) + timedelta(hours=47)

    valid = client.get("/api/auth/invite/validate", params={"token": "invite-token-phase6"})
    assert valid.status_code == 200, valid.text
    assert valid.json()["valid"] is True

    accepted = client.post(
        "/api/auth/invite/accept",
        json={"token": "invite-token-phase6", "password": "SuperSecure1"},
    )
    assert accepted.status_code == 200, accepted.text
    login_payload = accepted.json()
    assert login_payload.get("access_token")
    assert login_payload["user"]["role"] == "EXTERNAL_PARTNER"

    replay = client.post(
        "/api/auth/invite/accept",
        json={"token": "invite-token-phase6", "password": "AnotherStrongPass1"},
    )
    assert replay.status_code == 400


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
