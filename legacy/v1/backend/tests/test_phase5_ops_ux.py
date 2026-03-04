from __future__ import annotations

from fastapi.testclient import TestClient
import pytest

from app.core.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.approval import Approval
from app.models.assignment import Assignment
from app.models.audit import ActivityLog
from app.models.enums import ApprovalType, AssignmentStatus, CaseType, Role, ServiceLine, TaskStatus
from app.models.task import AssignmentTask
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



def test_approvals_inbox_includes_summary_fields(test_env):
    client, db, users, auth_state = test_env

    _as_user(auth_state, users["field"])
    created = client.post("/api/assignments/drafts", json=_draft_payload())
    assert created.status_code == 201, created.text

    approval = db.query(Approval).filter(Approval.approval_type == ApprovalType.DRAFT_ASSIGNMENT).first()
    assert approval is not None

    _as_user(auth_state, users["admin"])
    inbox = client.get("/api/approvals/inbox", params={"approval_type": "DRAFT_ASSIGNMENT"})
    assert inbox.status_code == 200, inbox.text
    rows = inbox.json()
    assert len(rows) >= 1
    row = rows[0]
    assert row.get("entity_summary")
    assert row.get("assignment_code")
    assert row.get("requested_by_name")



def test_dashboard_activity_summary_shape_and_counts(test_env):
    client, db, users, auth_state = test_env

    assignment = Assignment(
        assignment_code=generate_assignment_code(db),
        case_type=CaseType.DIRECT_CLIENT,
        service_line=ServiceLine.VALUATION,
        valuer_client_name="Client",
        borrower_name="Borrower",
        created_by_user_id=users["admin"].id,
        assigned_to_user_id=users["ops"].id,
        status=AssignmentStatus.PENDING,
    )
    db.add(assignment)
    db.flush()

    db.add(
        AssignmentTask(
            assignment_id=assignment.id,
            title="Follow up",
            description="Need update",
            status=TaskStatus.TODO,
            assigned_to_user_id=users["ops"].id,
            created_by_user_id=users["admin"].id,
        )
    )
    db.add(
        ActivityLog(
            assignment_id=assignment.id,
            actor_user_id=users["admin"].id,
            type="DOCUMENT_UPLOADED",
            message="Uploaded doc",
        )
    )
    db.commit()

    _as_user(auth_state, users["admin"])
    response = client.get("/api/dashboard/activity-summary")
    assert response.status_code == 200, response.text
    payload = response.json()

    assert "assignments_in_progress_count" in payload
    assert "active_users_count" in payload
    assert "recent_uploads_count" in payload
    assert "recent_downloads_count" in payload
    assert "top_active_assignments" in payload
    assert payload["assignments_in_progress_count"] >= 1
    assert isinstance(payload["top_active_assignments"], list)



def test_checklist_rules_resolve_for_core_service_lines(test_env):
    client, _db, users, auth_state = test_env
    _as_user(auth_state, users["admin"])

    lb = client.get(
        "/api/master/checklist-rules",
        params={"service_line_key": "VALUATION_LB", "blocks": "NORMAL_LAND,BUILT_UP"},
    )
    assert lb.status_code == 200, lb.text
    lb_payload = lb.json()
    assert "TITLE_DEED" in lb_payload["required_categories"]
    assert "PLAN_APPROVAL" in lb_payload["required_categories"]

    agri = client.get(
        "/api/master/checklist-rules",
        params={"service_line_key": "VALUATION_AGRI", "blocks": "SURVEY_ROWS"},
    )
    assert agri.status_code == 200, agri.text
    agri_payload = agri.json()
    assert "RTC" in agri_payload["required_categories"]
    assert "MUTATION" in agri_payload["required_categories"]

    plot = client.get(
        "/api/master/checklist-rules",
        params={"service_line_key": "VALUATION_PLOT", "blocks": "NORMAL_LAND"},
    )
    assert plot.status_code == 200, plot.text
    plot_payload = plot.json()
    assert "GUIDELINE_SCREENSHOT" in (plot_payload["required_categories"] + plot_payload["optional_categories"])



def test_document_template_slots_merge_by_land_blocks(test_env):
    client, _db, users, auth_state = test_env
    _as_user(auth_state, users["admin"])

    response = client.get(
        "/api/master/document-template-slots",
        params={"service_line_key": "VALUATION_LB", "blocks": "NORMAL_LAND,SURVEY_ROWS,BUILT_UP"},
    )
    assert response.status_code == 200, response.text
    payload = response.json()

    slots = payload.get("slots") or []
    categories = {slot["category"] for slot in slots}
    assert "TITLE_DEED" in categories
    assert "RTC" in categories
    assert "PLAN_APPROVAL" in categories

    title_deed_slot = next((slot for slot in slots if slot["category"] == "TITLE_DEED"), None)
    rtc_slot = next((slot for slot in slots if slot["category"] == "RTC"), None)
    assert title_deed_slot is not None and title_deed_slot["required"] is True
    assert rtc_slot is not None and rtc_slot["required"] is True
