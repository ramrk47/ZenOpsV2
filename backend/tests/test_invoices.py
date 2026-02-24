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
from app.models.assignment import Assignment
from app.models.enums import CaseType, Role, ServiceLine
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

    user = User(
        email="admin@example.com",
        hashed_password="not-used",
        role=Role.ADMIN,
        full_name="Admin",
        is_active=True,
    )
    db.add(user)
    db.flush()

    assignment = Assignment(
        assignment_code="Z-TEST-0001",
        case_type=CaseType.BANK,
        service_line=ServiceLine.VALUATION,
        created_by_user_id=user.id,
        fees=Decimal("1000.00"),
    )
    db.add(assignment)
    db.commit()

    def override_get_db():
        try:
            yield db
        finally:
            pass

    def override_get_current_user():
        return user

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    client_instance = TestClient(app)
    try:
        yield client_instance, assignment
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
    client_instance, assignment = client
    _create_invoice(client_instance, assignment.id)

    response = client_instance.get("/api/invoices")
    assert response.status_code == 200
    payload = response.json()
    assert payload["items"], "Expected at least one invoice in list"
    row = payload["items"][0]
    assert row["grand_total"] is not None
    assert row["amount_due"] is not None


def test_payment_updates_amount_due(client):
    client_instance, assignment = client
    created = _create_invoice(client_instance, assignment.id)
    issue_resp = client_instance.post(f"/api/invoices/{created['id']}/issue", json={})
    assert issue_resp.status_code == 200, issue_resp.text
    issued = issue_resp.json()

    amount_due = issued["amount_due"]
    pay_resp = client_instance.post(
        f"/api/invoices/{created['id']}/payments",
        json={"amount": amount_due, "mode": "MANUAL"},
    )
    assert pay_resp.status_code == 200, pay_resp.text
    paid = pay_resp.json()
    assert Decimal(str(paid["amount_due"])) == Decimal("0")
    assert paid["status"] == "PAID"


def test_reminder_dedupe(client):
    client_instance, assignment = client
    created = _create_invoice(client_instance, assignment.id)
    issue_resp = client_instance.post(f"/api/invoices/{created['id']}/issue", json={})
    assert issue_resp.status_code == 200

    first = client_instance.post(f"/api/invoices/{created['id']}/remind")
    assert first.status_code == 200
    second = client_instance.post(f"/api/invoices/{created['id']}/remind")
    assert second.status_code == 429


def test_export_csv(client):
    client_instance, assignment = client
    _create_invoice(client_instance, assignment.id)

    response = client_instance.get("/api/invoices/export.csv")
    assert response.status_code == 200
    assert "invoice_number" in response.text
