from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.deps import get_current_user
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.enums import Role
from app.models.user import User


@pytest.fixture()
def test_env():
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
        yield client, users, auth_state
    finally:
        client.close()
        db.close()
        app.dependency_overrides.clear()


def _as_user(auth_state: dict, user: User) -> None:
    auth_state["user"] = user


def _create_service_line(client: TestClient, *, key: str, name: str, policy_json: dict) -> dict:
    response = client.post(
        "/api/master/service-lines",
        json={
            "key": key,
            "name": name,
            "sort_order": 10,
            "is_active": True,
            "policy_json": policy_json,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _assignment_payload(service_line_id: int | None = None) -> dict:
    payload = {
        "case_type": "DIRECT_CLIENT",
        "service_line": "VALUATION",
        "valuer_client_name": "Direct Client",
        "borrower_name": "Borrower",
        "status": "PENDING",
        "uom": "SQFT",
        "site_visit_date": None,
        "report_due_date": None,
    }
    if service_line_id is not None:
        payload["service_line_id"] = service_line_id
    return payload


def test_service_line_mutation_requires_admin_and_list_returns_rows(test_env):
    client, users, auth_state = test_env

    _as_user(auth_state, users["assistant"])
    denied = client.post(
        "/api/master/service-lines",
        json={"key": "TEST_LINE", "name": "Test Line", "sort_order": 1, "is_active": True, "policy_json": {}},
    )
    assert denied.status_code == 403

    _as_user(auth_state, users["admin"])
    created = _create_service_line(
        client,
        key="TEST_LINE",
        name="Test Line",
        policy_json={"requires": ["NORMAL_LAND"], "optional": [], "uom_required": True},
    )
    assert created["key"] == "TEST_LINE"

    listed = client.get("/api/master/service-lines")
    assert listed.status_code == 200, listed.text
    assert any(row["key"] == "TEST_LINE" for row in listed.json())


def test_assignment_create_requires_uom(test_env):
    client, users, auth_state = test_env
    _as_user(auth_state, users["admin"])

    response = client.post(
        "/api/assignments",
        json={
            "case_type": "DIRECT_CLIENT",
            "service_line": "VALUATION",
            "valuer_client_name": "Direct Client",
            "borrower_name": "Borrower",
            "status": "PENDING",
        },
    )
    assert response.status_code == 422


def test_others_service_line_requires_other_text(test_env):
    client, users, auth_state = test_env
    _as_user(auth_state, users["admin"])
    others = _create_service_line(
        client,
        key="OTHERS",
        name="Others",
        policy_json={"requires": [], "optional": ["NORMAL_LAND"], "uom_required": True},
    )

    payload = _assignment_payload(service_line_id=others["id"])
    response = client.post("/api/assignments", json=payload)
    assert response.status_code == 400
    assert "service_line_other_text" in response.text


def test_survey_rows_persist_and_are_ordered(test_env):
    client, users, auth_state = test_env
    _as_user(auth_state, users["admin"])
    agri = _create_service_line(
        client,
        key="VALUATION_AGRI",
        name="Valuation (Agri)",
        policy_json={"requires": ["SURVEY_ROWS"], "optional": ["NORMAL_LAND"], "uom_required": True},
    )

    payload = _assignment_payload(service_line_id=agri["id"])
    payload["land_surveys"] = [
        {
            "serial_no": 2,
            "survey_no": "S-200",
            "acre": 2,
            "gunta": 5,
            "aana": 0,
            "kharab_acre": 0.5,
            "kharab_gunta": 0,
            "kharab_aana": 0,
        },
        {
            "serial_no": 1,
            "survey_no": "S-100",
            "acre": 1,
            "gunta": 10,
            "aana": 0,
            "kharab_acre": 0,
            "kharab_gunta": 1,
            "kharab_aana": 0,
        },
    ]

    created = client.post("/api/assignments", json=payload)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["land_surveys"][0]["survey_no"] == "S-100"
    assert body["land_surveys"][1]["survey_no"] == "S-200"

    detail = client.get(f"/api/assignments/{body['id']}")
    assert detail.status_code == 200, detail.text
    detail_body = detail.json()
    assert len(detail_body["land_surveys"]) == 2
    assert detail_body["land_survey_totals"]["total_area_acre"] == "3.000"


def test_non_admin_cannot_set_admin_only_fields(test_env):
    client, users, auth_state = test_env
    _as_user(auth_state, users["admin"])
    standard_line = _create_service_line(
        client,
        key="VALUATION_LB",
        name="Valuation LB",
        policy_json={"requires": ["NORMAL_LAND"], "optional": ["BUILT_UP"], "uom_required": True},
    )

    _as_user(auth_state, users["assistant"])
    payload = _assignment_payload(service_line_id=standard_line["id"])
    payload["payment_timing"] = "PRE"
    payload["preferred_payment_mode"] = "CASH"
    denied = client.post("/api/assignments", json=payload)
    assert denied.status_code == 403


def test_admin_can_set_override_and_payment_preferences(test_env):
    client, users, auth_state = test_env
    _as_user(auth_state, users["admin"])
    standard_line = _create_service_line(
        client,
        key="VALUATION_PLOT",
        name="Valuation Plot",
        policy_json={"requires": ["NORMAL_LAND"], "optional": [], "uom_required": True},
    )

    payload = _assignment_payload(service_line_id=standard_line["id"])
    payload["payment_timing"] = "POST"
    payload["payment_completeness"] = "PARTIAL"
    payload["preferred_payment_mode"] = "UPI"
    payload["land_policy_override_json"] = {
        "requires": ["NORMAL_LAND", "SURVEY_ROWS"],
        "optional": ["BUILT_UP"],
        "uom_required": True,
        "allow_assignment_override": True,
    }
    payload["land_surveys"] = [
        {
            "survey_no": "S-1",
            "acre": 1,
            "gunta": 0,
            "aana": 0,
            "kharab_acre": 0,
            "kharab_gunta": 0,
            "kharab_aana": 0,
        }
    ]

    response = client.post("/api/assignments", json=payload)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["payment_timing"] == "POST"
    assert body["payment_completeness"] == "PARTIAL"
    assert body["preferred_payment_mode"] == "UPI"
    assert body["land_policy_override_json"]["requires"] == ["NORMAL_LAND", "SURVEY_ROWS"]
