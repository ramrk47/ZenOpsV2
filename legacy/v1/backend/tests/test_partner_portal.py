from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import create_access_token
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.assignment import Assignment
from app.models.enums import CaseType, InvoiceStatus, Role, ServiceLine
from app.models.invoice import Invoice
from app.models.partner import ExternalPartner
from app.models.user import User


@pytest.fixture()
def client():
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    partner = ExternalPartner(display_name="Patil Valuations", is_active=True)
    db.add(partner)
    db.flush()

    partner_user = User(
        email="patil@example.com",
        hashed_password="not-used",
        role=Role.EXTERNAL_PARTNER,
        full_name="Patil",
        is_active=True,
        partner_id=partner.id,
    )
    db.add(partner_user)
    db.flush()

    other_partner = ExternalPartner(display_name="Other Partner", is_active=True)
    db.add(other_partner)
    db.flush()

    other_user = User(
        email="other@example.com",
        hashed_password="not-used",
        role=Role.EXTERNAL_PARTNER,
        full_name="Other",
        is_active=True,
        partner_id=other_partner.id,
    )
    db.add(other_user)
    db.flush()

    assignment = Assignment(
        assignment_code="Z-PARTNER-0001",
        case_type=CaseType.EXTERNAL_VALUER,
        service_line=ServiceLine.VALUATION,
        created_by_user_id=partner_user.id,
        partner_id=partner.id,
        borrower_name="Borrower",
    )
    db.add(assignment)
    db.flush()

    invoice = Invoice(
        assignment_id=assignment.id,
        partner_id=partner.id,
        invoice_number="INV-001",
        issued_date=date.today(),
        due_date=date.today(),
        status=InvoiceStatus.ISSUED,
        subtotal=Decimal("1000.00"),
        tax_rate=Decimal("0.00"),
        tax_amount=Decimal("0.00"),
        total_amount=Decimal("1000.00"),
        amount_paid=Decimal("0.00"),
        amount_due=Decimal("1000.00"),
        amount_credited=Decimal("0.00"),
        created_by_user_id=partner_user.id,
        is_paid=False,
    )
    db.add(invoice)
    db.commit()

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db

    client_instance = TestClient(app)
    try:
        yield client_instance, partner_user, other_user, assignment, invoice
    finally:
        client_instance.close()
        db.close()
        app.dependency_overrides.clear()


def _auth_headers(user: User) -> dict[str, str]:
    token = create_access_token({"sub": str(user.id), "role": str(user.role)})
    return {"Authorization": f"Bearer {token}"}


def test_partner_blocked_from_internal_routes(client):
    client_instance, partner_user, _other_user, _assignment, _invoice = client
    resp = client_instance.get("/api/assignments", headers=_auth_headers(partner_user))
    assert resp.status_code == 403


def test_partner_commission_create_and_submit(client):
    client_instance, partner_user, _other_user, _assignment, _invoice = client
    resp = client_instance.post(
        "/api/partner/commissions",
        json={"borrower_name": "Test Borrower"},
        headers=_auth_headers(partner_user),
    )
    assert resp.status_code == 201, resp.text
    commission = resp.json()

    submit = client_instance.post(
        f"/api/partner/commissions/{commission['id']}/submit",
        headers=_auth_headers(partner_user),
    )
    assert submit.status_code == 200, submit.text
    assert submit.json()["status"] == "SUBMITTED"


def test_partner_invoice_access_scoped(client):
    client_instance, partner_user, other_user, _assignment, invoice = client
    resp = client_instance.get("/api/partner/invoices", headers=_auth_headers(partner_user))
    assert resp.status_code == 200
    assert resp.json(), "Expected partner invoices"

    other_resp = client_instance.get(f"/api/partner/invoices/{invoice.id}", headers=_auth_headers(other_user))
    assert other_resp.status_code == 404
