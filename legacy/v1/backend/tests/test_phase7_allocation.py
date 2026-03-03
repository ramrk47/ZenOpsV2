from __future__ import annotations

from datetime import datetime, timedelta, timezone

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
from app.models.audit import ActivityLog
from app.models.enums import Role, TaskStatus
from app.models.task import AssignmentTask
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
            hashed_password="x",
            role=Role.ADMIN,
            roles=[Role.ADMIN.value],
            full_name="Admin",
            is_active=True,
        ),
        "ops": User(
            email="ops@example.com",
            hashed_password="x",
            role=Role.OPS_MANAGER,
            roles=[Role.OPS_MANAGER.value],
            full_name="Ops",
            is_active=True,
        ),
        "assistant": User(
            email="assistant@example.com",
            hashed_password="x",
            role=Role.ASSISTANT_VALUER,
            roles=[Role.ASSISTANT_VALUER.value],
            full_name="Assistant",
            is_active=True,
        ),
        "field": User(
            email="field@example.com",
            hashed_password="x",
            role=Role.FIELD_VALUER,
            roles=[Role.FIELD_VALUER.value],
            full_name="Field",
            is_active=True,
        ),
        "finance": User(
            email="finance@example.com",
            hashed_password="x",
            role=Role.FINANCE,
            roles=[Role.FINANCE.value],
            full_name="Finance",
            is_active=True,
        ),
        "associate": User(
            email="associate@example.com",
            hashed_password="x",
            role=Role.EXTERNAL_PARTNER,
            roles=[Role.EXTERNAL_PARTNER.value],
            full_name="Associate",
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
        app.dependency_overrides.clear()


def _as_user(auth_state: dict, user: User) -> None:
    auth_state["user"] = user


def _create_service_line(
    client: TestClient,
    *,
    key: str,
    name: str,
    allocation_policy_json: dict | None = None,
) -> dict:
    response = client.post(
        "/api/master/service-lines",
        json={
            "key": key,
            "name": name,
            "sort_order": 10,
            "is_active": True,
            "policy_json": {
                "requires": ["NORMAL_LAND"],
                "optional": ["BUILT_UP"],
                "uom_required": True,
                "allow_assignment_override": True,
            },
            "allocation_policy_json": allocation_policy_json,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _assignment_payload(service_line_id: int, *, assigned_to_user_id: int | None = None) -> dict:
    payload = {
        "case_type": "DIRECT_CLIENT",
        "service_line": "VALUATION",
        "service_line_id": service_line_id,
        "valuer_client_name": "Direct Client",
        "borrower_name": "Borrower",
        "status": "PENDING",
        "uom": "SQFT",
    }
    if assigned_to_user_id is not None:
        payload["assigned_to_user_id"] = assigned_to_user_id
    return payload


def _create_assignment(
    client: TestClient,
    *,
    service_line_id: int,
    assigned_to_user_id: int | None = None,
) -> dict:
    response = client.post(
        "/api/assignments",
        json=_assignment_payload(service_line_id, assigned_to_user_id=assigned_to_user_id),
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_finance_user_cannot_be_assigned_to_valuation_service_line(test_env):
    client, _db, users, auth_state = test_env
    _as_user(auth_state, users["admin"])

    service_line = _create_service_line(
        client,
        key="VALUATION_LB",
        name="Valuation L&B",
    )

    response = client.post(
        "/api/assignments",
        json=_assignment_payload(service_line["id"], assigned_to_user_id=users["finance"].id),
    )
    assert response.status_code == 400, response.text
    detail = response.json().get("detail") or {}
    assert detail.get("code") == "ASSIGNEE_NOT_ELIGIBLE"
    assert detail.get("user_id") == users["finance"].id
    assert detail.get("reason") == "PRIMARY_ROLE_DENY"


def test_candidates_endpoint_orders_eligible_users_by_score(test_env):
    client, _db, users, auth_state = test_env
    _as_user(auth_state, users["admin"])

    service_line = _create_service_line(
        client,
        key="VALUATION_PLOT",
        name="Valuation Plot",
        allocation_policy_json={
            "eligible_roles": ["ASSISTANT_VALUER", "FIELD_VALUER"],
            "deny_roles": ["FINANCE", "HR"],
            "weights": {
                "open_assignments": 3,
                "overdue_tasks": 8,
                "due_soon": 4,
                "inactive_penalty": 6,
            },
            "max_open_assignments_soft": 12,
        },
    )

    _create_assignment(client, service_line_id=service_line["id"], assigned_to_user_id=users["field"].id)
    target = _create_assignment(client, service_line_id=service_line["id"])

    response = client.get(
        f"/api/assignments/{target['id']}/allocation/candidates",
        params={"include_ineligible": False},
    )
    assert response.status_code == 200, response.text
    rows = response.json()

    assert rows[0]["user_id"] == users["assistant"].id
    assert rows[1]["user_id"] == users["field"].id
    assert rows[0]["score"] < rows[1]["score"]


def test_assign_best_assigns_expected_user_and_logs_activity(test_env):
    client, db, users, auth_state = test_env
    _as_user(auth_state, users["admin"])

    service_line = _create_service_line(
        client,
        key="PROJECT_REPORT",
        name="Project Report",
        allocation_policy_json={
            "eligible_roles": ["ASSISTANT_VALUER", "FIELD_VALUER"],
            "deny_roles": ["FINANCE", "HR"],
            "weights": {
                "open_assignments": 3,
                "overdue_tasks": 8,
                "due_soon": 4,
                "inactive_penalty": 6,
            },
            "max_open_assignments_soft": 12,
        },
    )

    _create_assignment(client, service_line_id=service_line["id"], assigned_to_user_id=users["field"].id)
    target = _create_assignment(client, service_line_id=service_line["id"])

    response = client.post(f"/api/assignments/{target['id']}/allocation/assign-best")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["candidate"]["user_id"] == users["assistant"].id
    assert payload["assignment"]["assigned_to_user_id"] == users["assistant"].id

    assignment = db.get(Assignment, target["id"])
    assert assignment is not None
    assert assignment.assigned_to_user_id == users["assistant"].id

    log_row = (
        db.query(ActivityLog)
        .filter(ActivityLog.assignment_id == target["id"], ActivityLog.type == "ASSIGNMENT_AUTO_ASSIGNED")
        .order_by(ActivityLog.id.desc())
        .first()
    )
    assert log_row is not None
    assert (log_row.payload_json or {}).get("assignee_user_id") == users["assistant"].id


def test_policy_weights_override_changes_recommendation_deterministically(test_env):
    client, db, users, auth_state = test_env
    _as_user(auth_state, users["admin"])

    service_line = _create_service_line(
        client,
        key="VALUATION_AGRI",
        name="Valuation Agri",
        allocation_policy_json={
            "eligible_roles": ["ASSISTANT_VALUER", "FIELD_VALUER"],
            "deny_roles": ["FINANCE", "HR"],
            "weights": {
                "open_assignments": 3,
                "overdue_tasks": 8,
                "due_soon": 4,
                "inactive_penalty": 6,
            },
            "max_open_assignments_soft": 12,
        },
    )

    _create_assignment(client, service_line_id=service_line["id"], assigned_to_user_id=users["assistant"].id)
    target = _create_assignment(client, service_line_id=service_line["id"])

    db.add(
        AssignmentTask(
            assignment_id=target["id"],
            title="Overdue task",
            description="Task backlog",
            status=TaskStatus.TODO,
            assigned_to_user_id=users["field"].id,
            created_by_user_id=users["admin"].id,
            due_at=datetime.now(timezone.utc) - timedelta(hours=2),
        )
    )
    db.commit()

    before = client.get(
        f"/api/assignments/{target['id']}/allocation/candidates",
        params={"include_ineligible": False},
    )
    assert before.status_code == 200, before.text
    before_rows = before.json()
    assert before_rows[0]["user_id"] == users["assistant"].id

    update = client.patch(
        f"/api/master/service-lines/{service_line['id']}",
        json={
            "allocation_policy_json": {
                "eligible_roles": ["ASSISTANT_VALUER", "FIELD_VALUER"],
                "deny_roles": ["FINANCE", "HR"],
                "weights": {
                    "open_assignments": 10,
                    "overdue_tasks": 1,
                    "due_soon": 4,
                    "inactive_penalty": 6,
                },
                "max_open_assignments_soft": 12,
            }
        },
    )
    assert update.status_code == 200, update.text

    after = client.get(
        f"/api/assignments/{target['id']}/allocation/candidates",
        params={"include_ineligible": False},
    )
    assert after.status_code == 200, after.text
    after_rows = after.json()
    assert after_rows[0]["user_id"] == users["field"].id


def test_associate_user_cannot_be_assigned_to_internal_assignment(test_env):
    client, _db, users, auth_state = test_env
    _as_user(auth_state, users["admin"])

    service_line = _create_service_line(
        client,
        key="VALUATION_INTERNAL",
        name="Valuation Internal",
        allocation_policy_json={
            "eligible_roles": ["EXTERNAL_PARTNER", "ASSISTANT_VALUER"],
            "deny_roles": [],
            "weights": {
                "open_assignments": 3,
                "overdue_tasks": 8,
                "due_soon": 4,
                "inactive_penalty": 6,
            },
            "max_open_assignments_soft": 12,
        },
    )

    response = client.post(
        "/api/assignments",
        json=_assignment_payload(service_line["id"], assigned_to_user_id=users["associate"].id),
    )
    assert response.status_code == 400, response.text
    detail = response.json().get("detail") or {}
    assert detail.get("code") == "ASSIGNEE_NOT_ELIGIBLE"
    assert detail.get("reason") == "ASSOCIATE_INTERNAL_RESTRICTED"
