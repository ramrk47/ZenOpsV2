import os
import sys
from pathlib import Path
from datetime import date, timedelta

# Configure environment before importing app modules.
BASE_DIR = Path(__file__).resolve().parents[1]
DB_PATH = BASE_DIR / "backend" / ".smoke.db"

if not os.getenv("DATABASE_URL"):
    os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{DB_PATH}"
if not os.getenv("JWT_SECRET"):
    os.environ["JWT_SECRET"] = "smoke_secret"

sys.path.append(str(BASE_DIR / "backend"))

from fastapi.testclient import TestClient

from app.main import app
from app.core.security import get_password_hash
from app.db.base import Base
from app.db.session import engine, SessionLocal
from app.models.enums import Role, ApprovalEntityType, ApprovalActionType
from app.models.user import User


def seed_users():
    with SessionLocal() as db:
        admin = User(
            email="admin@zenops.local",
            hashed_password=get_password_hash("password"),
            full_name="Admin User",
            role=Role.ADMIN,
            is_active=True,
        )
        finance = User(
            email="finance@zenops.local",
            hashed_password=get_password_hash("password"),
            full_name="Finance User",
            role=Role.FINANCE,
            is_active=True,
        )
        assignee = User(
            email="assistant@zenops.local",
            hashed_password=get_password_hash("password"),
            full_name="Assistant",
            role=Role.ASSISTANT_VALUER,
            is_active=True,
        )
        db.add_all([admin, finance, assignee])
        db.commit()


def ensure_bootstrap():
    bootstrap = os.getenv("SMOKE_BOOTSTRAP", "1").lower() not in {"0", "false", "no"}
    if not bootstrap:
        return
    if DB_PATH.exists():
        DB_PATH.unlink()
    Base.metadata.create_all(bind=engine)
    seed_users()


def get_user_id(email: str) -> int:
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            raise RuntimeError(f"Missing user seed for {email}")
        return int(user.id)


def get_token(client: TestClient, email: str, password: str) -> str:
    resp = client.post("/api/auth/login", data={"username": email, "password": password})
    resp.raise_for_status()
    return resp.json()["access_token"]


def main():
    ensure_bootstrap()

    admin_id = get_user_id("admin@zenops.local")
    finance_id = get_user_id("finance@zenops.local")
    assistant_id = get_user_id("assistant@zenops.local")

    client = TestClient(app)
    admin_token = get_token(client, "admin@zenops.local", "password")
    finance_token = get_token(client, "finance@zenops.local", "password")
    assistant_token = get_token(client, "assistant@zenops.local", "password")

    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    finance_headers = {"Authorization": f"Bearer {finance_token}"}
    assistant_headers = {"Authorization": f"Bearer {assistant_token}"}

    # Create assignment (direct client case).
    assignment_payload = {
        "case_type": "DIRECT_CLIENT",
        "valuer_client_name": "Smoke Client",
        "borrower_name": "Smoke Borrower",
        "status": "PENDING",
        "assigned_to_user_id": assistant_id,
        "assignee_user_ids": [assistant_id],
        "notes": "smoke",
    }
    create_resp = client.post("/api/assignments", json=assignment_payload, headers=admin_headers)
    create_resp.raise_for_status()
    assignment = create_resp.json()
    assignment_id = assignment["id"]
    assignment_code = assignment["assignment_code"]

    caps_resp = client.get("/api/auth/capabilities", headers=admin_headers)
    caps_resp.raise_for_status()

    due_resp = client.get("/api/assignments/with-due", headers=admin_headers)
    due_resp.raise_for_status()

    # List assignments with filter.
    list_resp = client.get(
        "/api/assignments",
        params={"assigned_to_user_id": assistant_id},
        headers=admin_headers,
    )
    list_resp.raise_for_status()
    assert any(a["id"] == assignment_id for a in list_resp.json()), "Assignment filter failed"

    # Assignment detail loads.
    detail_resp = client.get(f"/api/assignments/{assignment_id}/detail", headers=admin_headers)
    detail_resp.raise_for_status()

    # Create task -> notification for assignee.
    task_payload = {
        "title": "Smoke Task",
        "description": "Check docs",
        "status": "TODO",
        "assigned_to_user_id": assistant_id,
    }
    task_resp = client.post(
        f"/api/assignments/{assignment_id}/tasks",
        json=task_payload,
        headers=admin_headers,
    )
    task_resp.raise_for_status()

    notif_resp = client.get("/api/notifications", headers=assistant_headers)
    notif_resp.raise_for_status()
    assert any(n["type"] == "TASK_ASSIGNED" for n in notif_resp.json()), "Task notification missing"

    # Create approval request -> inbox.
    approval_payload = {
        "entity_type": ApprovalEntityType.ASSIGNMENT.value,
        "entity_id": assignment_id,
        "action_type": ApprovalActionType.DOC_REQUEST.value,
        "reason": "Smoke approval",
        "assignment_id": assignment_id,
    }
    approval_resp = client.post("/api/approvals/request", json=approval_payload, headers=assistant_headers)
    approval_resp.raise_for_status()

    inbox_resp = client.get("/api/approvals/inbox", headers=admin_headers)
    inbox_resp.raise_for_status()
    assert any(a["id"] == approval_resp.json()["id"] for a in inbox_resp.json()), "Approval not in inbox"

    # Leave approval creates calendar block.
    leave_payload = {
        "leave_type": "FULL_DAY",
        "start_date": date.today().isoformat(),
        "end_date": date.today().isoformat(),
        "reason": "Smoke leave",
    }
    leave_resp = client.post("/api/leave/request", json=leave_payload, headers=assistant_headers)
    leave_resp.raise_for_status()
    leave_id = leave_resp.json()["id"]

    approve_leave = client.post(f"/api/leave/{leave_id}/approve", headers=admin_headers)
    approve_leave.raise_for_status()

    calendar_resp = client.get(
        "/api/calendar/events",
        params={"event_type": "LEAVE"},
        headers=assistant_headers,
    )
    calendar_resp.raise_for_status()
    assert any(e.get("related_leave_request_id") == leave_id for e in calendar_resp.json()), "Leave calendar block missing"

    # Create invoice and verify assignment code linkage.
    invoice_payload = {
        "assignment_id": assignment_id,
        "issued_date": (date.today() - timedelta(days=15)).isoformat(),
        "due_date": (date.today() - timedelta(days=10)).isoformat(),
        "items": [],
    }
    invoice_resp = client.post("/api/invoices", json=invoice_payload, headers=admin_headers)
    invoice_resp.raise_for_status()
    invoice = invoice_resp.json()
    assert assignment_code in invoice["invoice_number"], "Invoice number missing assignment code"

    issue_resp = client.post(f"/api/invoices/{invoice['id']}/issue", headers=admin_headers)
    issue_resp.raise_for_status()

    remind_headers = {"Authorization": f"Bearer {finance_token}", "Idempotency-Key": "smoke-remind-1"}
    remind_resp = client.post(f"/api/invoices/{invoice['id']}/remind", headers=remind_headers)
    remind_resp.raise_for_status()
    remind_repeat = client.post(f"/api/invoices/{invoice['id']}/remind", headers=remind_headers)
    remind_repeat.raise_for_status()

    remind_dupe = client.post(
        f"/api/invoices/{invoice['id']}/remind",
        headers={"Authorization": f"Bearer {finance_token}", "Idempotency-Key": "smoke-remind-2"},
    )
    assert remind_dupe.status_code == 429, "Reminder dedupe failed"

    notif_resp = client.get("/api/notifications", headers=finance_headers)
    notif_resp.raise_for_status()
    assert any(
        n["type"] == "PAYMENT_PENDING" and (n.get("payload_json") or {}).get("invoice_id") == invoice["id"]
        for n in notif_resp.json()
    ), "Reminder notification missing"

    followup_resp = client.get(
        "/api/invoices",
        params={"create_followups": True, "overdue_days": 7},
        headers=finance_headers,
    )
    followup_resp.raise_for_status()
    followup_resp_repeat = client.get(
        "/api/invoices",
        params={"create_followups": True, "overdue_days": 7},
        headers=finance_headers,
    )
    followup_resp_repeat.raise_for_status()

    tasks_resp = client.get("/api/tasks/my", params={"include_done": False, "limit": 200}, headers=finance_headers)
    tasks_resp.raise_for_status()
    overdue_tasks = [
        t for t in tasks_resp.json()
        if t.get("template_type") == "invoice_overdue" and invoice["invoice_number"] in t.get("title", "")
    ]
    assert len(overdue_tasks) == 1, "Follow-up task duplicated"

    print("SMOKE OK")


if __name__ == "__main__":
    main()
