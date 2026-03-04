from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.deps import get_current_user
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.approval import Approval
from app.models.assignment import Assignment
from app.models.enums import ApprovalType, CaseType, Role, ServiceLine
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

    users = {
        "admin": User(
            email="admin@example.com",
            hashed_password="not-used",
            role=Role.ADMIN,
            full_name="Admin",
            is_active=True,
        ),
        "ops": User(
            email="ops@example.com",
            hashed_password="not-used",
            role=Role.OPS_MANAGER,
            full_name="Ops",
            is_active=True,
        ),
    }
    db.add_all(list(users.values()))
    db.flush()

    assignment = Assignment(
        assignment_code="Z-TEST-0001",
        case_type=CaseType.BANK,
        service_line=ServiceLine.VALUATION,
        created_by_user_id=users["admin"].id,
        fees=Decimal("1000.00"),
    )
    db.add(assignment)
    db.commit()

    auth_state = {"user": users["admin"]}

    def override_get_db():
        try:
            yield db
        finally:
            pass

    def override_get_current_user():
        return auth_state["user"]

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    client_instance = TestClient(app)
    try:
        yield client_instance, assignment, db, users, auth_state
    finally:
        client_instance.close()
        db.close()
        app.dependency_overrides.clear()


def _create_invoice(client, assignment_id):
    response = client.post(
        "/api/invoices",
        json={
            "assignment_id": assignment_id,
            "issued_date": str(date.today()),
            "due_date": str(date.today()),
            "tax_rate": 0,
            "items": [
                {"description": "Service fee", "quantity": 1, "unit_price": 1000, "order_index": 0},
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_list_invoices_has_totals(client):
    client_instance, assignment, _db, _users, _auth_state = client
    _create_invoice(client_instance, assignment.id)

    response = client_instance.get("/api/invoices")
    assert response.status_code == 200
    payload = response.json()
    assert payload["items"], "Expected at least one invoice in list"
    row = payload["items"][0]
    assert row["grand_total"] is not None
    assert row["amount_due"] is not None


def test_payment_submission_requires_confirmation(client):
    client_instance, assignment, _db, _users, _auth_state = client
    created = _create_invoice(client_instance, assignment.id)
    issue_resp = client_instance.post(f"/api/invoices/{created['id']}/issue", json={})
    assert issue_resp.status_code == 200, issue_resp.text
    issued = issue_resp.json()

    amount_due = issued["amount_due"]
    pay_resp = client_instance.post(
        f"/api/invoices/{created['id']}/payments",
        json={"amount": amount_due, "mode": "CASH"},
    )
    assert pay_resp.status_code == 200, pay_resp.text
    submitted = pay_resp.json()
    assert Decimal(str(submitted["amount_due"])) == Decimal(str(amount_due))
    assert submitted["status"] != "PAID"
    assert submitted["payments"], "Expected payment submission to be stored"
    assert submitted["payments"][-1]["confirmation_status"] == "PENDING_CONFIRMATION"


def test_reminder_dedupe(client):
    client_instance, assignment, _db, _users, _auth_state = client
    created = _create_invoice(client_instance, assignment.id)
    issue_resp = client_instance.post(f"/api/invoices/{created['id']}/issue", json={})
    assert issue_resp.status_code == 200

    first = client_instance.post(f"/api/invoices/{created['id']}/remind")
    assert first.status_code == 200
    second = client_instance.post(f"/api/invoices/{created['id']}/remind")
    assert second.status_code == 429


def test_export_csv(client):
    client_instance, assignment, _db, _users, _auth_state = client
    _create_invoice(client_instance, assignment.id)

    response = client_instance.get("/api/invoices/export.csv")
    assert response.status_code == 200
    assert "invoice_number" in response.text


def test_payment_method_card_rejected(client):
    client_instance, assignment, _db, _users, _auth_state = client
    created = _create_invoice(client_instance, assignment.id)
    issue_resp = client_instance.post(f"/api/invoices/{created['id']}/issue", json={})
    assert issue_resp.status_code == 200, issue_resp.text
    amount_due = issue_resp.json()["amount_due"]

    pay_resp = client_instance.post(
        f"/api/invoices/{created['id']}/payments",
        json={"amount": amount_due, "mode": "CARD"},
    )
    assert pay_resp.status_code == 400
    assert "legacy payment method" in pay_resp.json().get("detail", "").lower()


def test_other_offline_payment_requires_note(client):
    client_instance, assignment, _db, _users, _auth_state = client
    created = _create_invoice(client_instance, assignment.id)
    issue_resp = client_instance.post(f"/api/invoices/{created['id']}/issue", json={})
    assert issue_resp.status_code == 200, issue_resp.text

    pay_resp = client_instance.post(
        f"/api/invoices/{created['id']}/payments",
        json={"amount": issue_resp.json()["amount_due"], "mode": "OTHER", "notes": "   "},
    )
    assert pay_resp.status_code == 400
    assert "require notes" in pay_resp.json().get("detail", "").lower()


def test_adjustments_and_approved_payments_flow_into_analytics(client):
    client_instance, assignment, db, users, auth_state = client
    created = _create_invoice(client_instance, assignment.id)
    invoice_id = created["id"]

    issue_resp = client_instance.post(f"/api/invoices/{invoice_id}/issue", json={})
    assert issue_resp.status_code == 200, issue_resp.text

    adjust_resp = client_instance.post(
        f"/api/invoices/{invoice_id}/adjustments",
        json={
            "amount": "100.00",
            "adjustment_type": "DISCOUNT",
            "reason": "Revised fee as per discussion",
        },
    )
    assert adjust_resp.status_code == 200, adjust_resp.text
    adjusted = adjust_resp.json()
    assert Decimal(str(adjusted["base_total"])) == Decimal("1000.00")
    assert Decimal(str(adjusted["adjustments_total"])) == Decimal("-100.00")
    assert Decimal(str(adjusted["net_total"])) == Decimal("900.00")
    assert Decimal(str(adjusted["amount_due"])) == Decimal("900.00")

    pending_payment_resp = client_instance.post(
        f"/api/invoices/{invoice_id}/payments",
        json={"amount": "400.00", "mode": "CASH", "notes": "Cash collected"},
    )
    assert pending_payment_resp.status_code == 200, pending_payment_resp.text
    pending_invoice = pending_payment_resp.json()
    assert Decimal(str(pending_invoice["amount_paid"])) == Decimal("0.00")
    assert Decimal(str(pending_invoice["amount_due"])) == Decimal("900.00")
    assert pending_invoice["payments"][-1]["confirmation_status"] == "PENDING_CONFIRMATION"

    pending_payment = pending_invoice["payments"][-1]
    approval = (
        db.query(Approval)
        .filter(
            Approval.approval_type == ApprovalType.PAYMENT_CONFIRMATION,
            Approval.entity_id == pending_payment["id"],
        )
        .first()
    )
    assert approval is not None

    analytics_before = client_instance.get("/api/analytics/source-intel")
    assert analytics_before.status_code == 200, analytics_before.text
    overview_before = analytics_before.json()["overview"]
    assert Decimal(str(overview_before["billed"])) == Decimal("900.00")
    assert Decimal(str(overview_before["collected"])) == Decimal("0.00")
    assert Decimal(str(overview_before["outstanding"])) == Decimal("900.00")

    auth_state["user"] = users["ops"]
    approve_resp = client_instance.post(f"/api/approvals/{approval.id}/approve", json={"comment": "Confirmed"})
    assert approve_resp.status_code == 200, approve_resp.text

    after_approval = client_instance.get(f"/api/invoices/{invoice_id}")
    assert after_approval.status_code == 200, after_approval.text
    approved_invoice = after_approval.json()
    assert Decimal(str(approved_invoice["base_total"])) == Decimal("1000.00")
    assert Decimal(str(approved_invoice["adjustments_total"])) == Decimal("-100.00")
    assert Decimal(str(approved_invoice["net_total"])) == Decimal("900.00")
    assert Decimal(str(approved_invoice["amount_paid"])) == Decimal("400.00")
    assert Decimal(str(approved_invoice["amount_due"])) == Decimal("500.00")

    analytics_after = client_instance.get("/api/analytics/source-intel")
    assert analytics_after.status_code == 200, analytics_after.text
    overview_after = analytics_after.json()["overview"]
    assert Decimal(str(overview_after["billed"])) == Decimal("900.00")
    assert Decimal(str(overview_after["collected"])) == Decimal("400.00")
    assert Decimal(str(overview_after["outstanding"])) == Decimal("500.00")
