from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.core.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.approval import Approval
from app.models.assignment import Assignment
from app.models.enums import (
    ApprovalStatus,
    ApprovalType,
    AssignmentStatus,
    CaseType,
    Role,
    ServiceLine,
)
from app.models.invoice import InvoicePayment
from app.models.user import User
from app.services.assignments import generate_assignment_code
from tests.postgres_utils import create_postgres_test_session


@pytest.fixture()
def test_env():
    engine, TestingSessionLocal = create_postgres_test_session()
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
        "finance": User(
            email="finance@example.com",
            hashed_password="not-used",
            role=Role.FINANCE,
            full_name="Finance",
            is_active=True,
        ),
        "assistant": User(
            email="assistant@example.com",
            hashed_password="not-used",
            role=Role.ASSISTANT_VALUER,
            full_name="Assistant",
            is_active=True,
        ),
        "field": User(
            email="field@example.com",
            hashed_password="not-used",
            role=Role.FIELD_VALUER,
            full_name="Field",
            is_active=True,
        ),
    }
    db.add_all(list(users.values()))
    db.commit()
    for user in users.values():
        db.refresh(user)

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

    client = TestClient(app)
    try:
        yield client, db, users, auth_state
    finally:
        client.close()
        db.close()
        engine.dispose()
        app.dependency_overrides.clear()


def _as_user(auth_state: dict, user: User) -> None:
    auth_state["user"] = user


def _draft_payload() -> dict:
    return {
        "case_type": "DIRECT_CLIENT",
        "service_line": "VALUATION",
        "uom": "SQFT",
        "valuer_client_name": "Draft Client",
        "borrower_name": "Draft Borrower",
        "phone": "9999999999",
        "address": "Test address",
        "status": "PENDING",
        "assignee_user_ids": [],
        "is_paid": False,
    }


def _create_assignment_for_invoice(db, *, creator_user_id: int, assignee_user_id: int | None = None) -> Assignment:
    assignment = Assignment(
        assignment_code=generate_assignment_code(db),
        case_type=CaseType.DIRECT_CLIENT,
        service_line=ServiceLine.VALUATION,
        valuer_client_name="Invoice Client",
        borrower_name="Invoice Borrower",
        created_by_user_id=creator_user_id,
        assigned_to_user_id=assignee_user_id,
        status=AssignmentStatus.PENDING,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return assignment


def test_field_valuer_draft_creation_uses_temp_code_and_pending_status(test_env):
    client, db, users, auth_state = test_env
    _as_user(auth_state, users["field"])

    response = client.post("/api/assignments/drafts", json=_draft_payload())

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["status"] == "DRAFT_PENDING_APPROVAL"
    assert payload["assignment_code"].startswith("DRAFT-")

    approval = (
        db.query(Approval)
        .filter(Approval.entity_id == payload["id"], Approval.approval_type == ApprovalType.DRAFT_ASSIGNMENT)
        .first()
    )
    assert approval is not None
    assert approval.status == ApprovalStatus.PENDING


def test_field_valuer_cannot_create_permanent_assignment(test_env):
    client, _db, users, auth_state = test_env
    _as_user(auth_state, users["field"])

    response = client.post("/api/assignments", json=_draft_payload())

    assert response.status_code == 403


def test_admin_approval_converts_draft_to_permanent_code(test_env):
    client, db, users, auth_state = test_env

    _as_user(auth_state, users["field"])
    created = client.post("/api/assignments/drafts", json=_draft_payload())
    assert created.status_code == 201, created.text
    assignment_id = created.json()["id"]

    approval = (
        db.query(Approval)
        .filter(Approval.entity_id == assignment_id, Approval.approval_type == ApprovalType.DRAFT_ASSIGNMENT)
        .first()
    )
    assert approval is not None

    _as_user(auth_state, users["admin"])
    approve_resp = client.post(f"/api/approvals/{approval.id}/approve", json={"comment": "Looks good"})
    assert approve_resp.status_code == 200, approve_resp.text

    db.refresh(approval)
    assignment = db.get(Assignment, assignment_id)
    assert assignment is not None
    assert assignment.status == AssignmentStatus.PENDING
    assert assignment.assignment_code.startswith("Z-")
    assert not assignment.assignment_code.startswith("DRAFT-")


def test_rejecting_draft_sets_rejected_status_and_reason(test_env):
    client, db, users, auth_state = test_env

    _as_user(auth_state, users["field"])
    created = client.post("/api/assignments/drafts", json=_draft_payload())
    assert created.status_code == 201, created.text
    assignment_id = created.json()["id"]

    approval = (
        db.query(Approval)
        .filter(Approval.entity_id == assignment_id, Approval.approval_type == ApprovalType.DRAFT_ASSIGNMENT)
        .first()
    )
    assert approval is not None

    _as_user(auth_state, users["admin"])
    reject_resp = client.post(
        f"/api/approvals/{approval.id}/reject",
        json={"comment": "Missing mandatory details"},
    )
    assert reject_resp.status_code == 200, reject_resp.text

    assignment = db.get(Assignment, assignment_id)
    db.refresh(approval)
    assert assignment is not None
    assert assignment.status == AssignmentStatus.DRAFT_REJECTED
    assert approval.status == ApprovalStatus.REJECTED
    assert approval.decision_reason == "Missing mandatory details"


def test_payment_requires_confirmation_before_invoice_becomes_paid(test_env):
    client, db, users, auth_state = test_env

    assignment = _create_assignment_for_invoice(
        db,
        creator_user_id=users["admin"].id,
        assignee_user_id=users["finance"].id,
    )

    _as_user(auth_state, users["admin"])
    created = client.post(
        "/api/invoices",
        json={
            "assignment_id": assignment.id,
            "issued_date": str(date.today()),
            "due_date": str(date.today()),
            "tax_rate": 0,
            "items": [{"description": "Service fee", "quantity": 1, "unit_price": 1000, "order_index": 0}],
        },
    )
    assert created.status_code == 201, created.text
    invoice_id = created.json()["id"]

    issue_resp = client.post(f"/api/invoices/{invoice_id}/issue", json={})
    assert issue_resp.status_code == 200, issue_resp.text
    initial_due = Decimal(str(issue_resp.json()["amount_due"]))

    _as_user(auth_state, users["finance"])
    add_payment = client.post(
        f"/api/invoices/{invoice_id}/payments",
        json={"amount": str(initial_due), "mode": "CASH"},
    )
    assert add_payment.status_code == 200, add_payment.text
    after_submit = add_payment.json()
    assert Decimal(str(after_submit["amount_due"])) == initial_due
    assert after_submit["status"] != "PAID"

    payment = (
        db.query(InvoicePayment)
        .filter(InvoicePayment.invoice_id == invoice_id)
        .order_by(InvoicePayment.id.desc())
        .first()
    )
    assert payment is not None
    assert payment.confirmation_status == "PENDING_CONFIRMATION"

    approval = (
        db.query(Approval)
        .filter(Approval.entity_id == payment.id, Approval.approval_type == ApprovalType.PAYMENT_CONFIRMATION)
        .first()
    )
    assert approval is not None
    assert approval.status == ApprovalStatus.PENDING

    _as_user(auth_state, users["admin"])
    approve_resp = client.post(f"/api/approvals/{approval.id}/approve", json={"comment": "Payment validated"})
    assert approve_resp.status_code == 200, approve_resp.text

    invoice_resp = client.get(f"/api/invoices/{invoice_id}")
    assert invoice_resp.status_code == 200, invoice_resp.text
    approved_invoice = invoice_resp.json()
    assert approved_invoice["status"] == "PAID"
    assert Decimal(str(approved_invoice["amount_due"])) == Decimal("0")


def test_final_document_requires_approval_before_becoming_final(test_env):
    client, db, users, auth_state = test_env

    assignment = _create_assignment_for_invoice(
        db,
        creator_user_id=users["admin"].id,
        assignee_user_id=users["assistant"].id,
    )

    _as_user(auth_state, users["assistant"])
    upload_resp = client.post(
        f"/api/assignments/{assignment.id}/documents/upload",
        files={"file": ("report.txt", b"draft report", "text/plain")},
        data={"category": "Draft Report", "is_final": "false"},
    )
    assert upload_resp.status_code == 201, upload_resp.text
    document_id = upload_resp.json()["id"]

    final_resp = client.post(
        f"/api/assignments/{assignment.id}/documents/{document_id}/final",
        json={"is_final": True},
    )
    assert final_resp.status_code == 200, final_resp.text
    pending_doc = final_resp.json()
    assert pending_doc["is_final"] is False
    assert pending_doc["review_status"] == "FINAL_PENDING_APPROVAL"

    approval = (
        db.query(Approval)
        .filter(Approval.entity_id == document_id, Approval.approval_type == ApprovalType.FINAL_DOC_REVIEW)
        .first()
    )
    assert approval is not None
    assert approval.status == ApprovalStatus.PENDING

    _as_user(auth_state, users["admin"])
    approve_resp = client.post(f"/api/approvals/{approval.id}/approve", json={"comment": "Final approved"})
    assert approve_resp.status_code == 200, approve_resp.text

    list_resp = client.get(f"/api/assignments/{assignment.id}/documents")
    assert list_resp.status_code == 200, list_resp.text
    doc = next(row for row in list_resp.json() if row["id"] == document_id)
    assert doc["is_final"] is True
    assert doc["review_status"] == "FINAL"
