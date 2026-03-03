from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import rbac
from app.models.assignment import Assignment
from app.models.audit import ActivityLog
from app.models.enums import AssignmentStatus, Role, TaskStatus
from app.models.master import ServiceLineMaster
from app.models.task import AssignmentTask
from app.models.user import User

DEFAULT_ALLOCATION_POLICY: dict[str, Any] = {
    "eligible_roles": ["ADMIN", "OPS_MANAGER", "ASSISTANT_VALUER", "FIELD_VALUER", "EMPLOYEE"],
    "deny_roles": ["FINANCE", "HR"],
    "weights": {
        "open_assignments": 3,
        "overdue_tasks": 8,
        "due_soon": 4,
        "inactive_penalty": 6,
        "field_valuer_bias": -2,
    },
    "max_open_assignments_soft": 12,
}
INACTIVE_WINDOW_MINUTES = 120
OVERDUE_TASK_STATUSES = {TaskStatus.TODO, TaskStatus.DOING, TaskStatus.BLOCKED}
OPEN_ASSIGNMENT_STATUSES = {
    AssignmentStatus.DRAFT_PENDING_APPROVAL,
    AssignmentStatus.PENDING,
    AssignmentStatus.SITE_VISIT,
    AssignmentStatus.UNDER_PROCESS,
    AssignmentStatus.SUBMITTED,
}


@dataclass
class AssigneeNotEligibleError(Exception):
    user_id: int
    reason: str
    message: str

    def to_detail(self) -> dict[str, Any]:
        return {
            "code": "ASSIGNEE_NOT_ELIGIBLE",
            "user_id": self.user_id,
            "reason": self.reason,
            "message": self.message,
        }


def _normalize_role_list(values: Iterable[str] | None) -> list[str]:
    normalized: list[str] = []
    for raw in values or []:
        value = str(raw or "").strip().upper()
        if not value:
            continue
        if value not in normalized:
            normalized.append(value)
    return normalized


def default_allocation_policy() -> dict[str, Any]:
    return {
        "eligible_roles": list(DEFAULT_ALLOCATION_POLICY["eligible_roles"]),
        "deny_roles": list(DEFAULT_ALLOCATION_POLICY["deny_roles"]),
        "weights": dict(DEFAULT_ALLOCATION_POLICY["weights"]),
        "max_open_assignments_soft": int(DEFAULT_ALLOCATION_POLICY["max_open_assignments_soft"]),
    }


def normalize_allocation_policy(policy_json: Optional[dict[str, Any]]) -> dict[str, Any]:
    payload = policy_json or {}
    eligible_roles = _normalize_role_list(payload.get("eligible_roles")) or list(DEFAULT_ALLOCATION_POLICY["eligible_roles"])
    deny_roles = _normalize_role_list(payload.get("deny_roles")) or list(DEFAULT_ALLOCATION_POLICY["deny_roles"])
    raw_weights = payload.get("weights") if isinstance(payload.get("weights"), dict) else {}
    weights = dict(DEFAULT_ALLOCATION_POLICY["weights"])
    for key in weights:
        if key not in raw_weights:
            continue
        try:
            weights[key] = int(raw_weights[key])
        except (TypeError, ValueError):
            continue
    try:
        max_open_assignments_soft = int(payload.get("max_open_assignments_soft", DEFAULT_ALLOCATION_POLICY["max_open_assignments_soft"]))
    except (TypeError, ValueError):
        max_open_assignments_soft = int(DEFAULT_ALLOCATION_POLICY["max_open_assignments_soft"])

    return {
        "eligible_roles": eligible_roles,
        "deny_roles": deny_roles,
        "weights": weights,
        "max_open_assignments_soft": max_open_assignments_soft,
    }


def resolve_allocation_policy(service_line: Optional[ServiceLineMaster]) -> dict[str, Any]:
    configured = getattr(service_line, "allocation_policy_json", None) if service_line is not None else None
    return normalize_allocation_policy(configured)


def _is_associate_only_workflow(assignment: Optional[Assignment]) -> bool:
    if assignment is None:
        return False
    return bool(assignment.partner_id or assignment.commission_request_id)


def evaluate_assignee_eligibility(
    user: User,
    *,
    service_line: Optional[ServiceLineMaster],
    assignment: Optional[Assignment] = None,
) -> dict[str, Any]:
    policy = resolve_allocation_policy(service_line)
    role_names = [role.value for role in rbac.roles_for_user(user)]
    role_set = set(role_names)
    primary_role = str(user.role.value if isinstance(user.role, Role) else user.role).upper() if user.role else None
    service_line_key = service_line.key if service_line else None

    if not user.is_active:
        return {
            "eligible": False,
            "reason": "INACTIVE_USER",
            "message": "Inactive users cannot be assigned",
            "service_line_key": service_line_key,
        }

    associate_workflow = _is_associate_only_workflow(assignment)
    if Role.EXTERNAL_PARTNER.value in role_set and not associate_workflow:
        return {
            "eligible": False,
            "reason": "ASSOCIATE_INTERNAL_RESTRICTED",
            "message": "External associates cannot be assigned to internal processing queues",
            "service_line_key": service_line_key,
        }

    deny_roles = set(policy.get("deny_roles") or [])
    if primary_role in deny_roles and not associate_workflow:
        return {
            "eligible": False,
            "reason": "PRIMARY_ROLE_DENY",
            "message": f"Primary role {primary_role} is not eligible for operational assignment allocation",
            "service_line_key": service_line_key,
        }

    eligible_roles = set(policy.get("eligible_roles") or [])
    if eligible_roles and not (role_set & eligible_roles):
        return {
            "eligible": False,
            "reason": "ROLE_NOT_ALLOWED",
            "message": "User role is not eligible for this service line allocation policy",
            "service_line_key": service_line_key,
        }

    return {
        "eligible": True,
        "reason": "ELIGIBLE",
        "message": "Eligible for assignment allocation",
        "service_line_key": service_line_key,
    }


def assert_assignees_eligible(
    db: Session,
    *,
    assignee_ids: Iterable[int],
    service_line: Optional[ServiceLineMaster],
    assignment: Optional[Assignment] = None,
) -> None:
    ids = sorted({int(uid) for uid in assignee_ids if uid})
    if not ids:
        return

    users = db.query(User).filter(User.id.in_(ids)).all()
    user_map = {int(user.id): user for user in users}
    missing = [uid for uid in ids if uid not in user_map]
    if missing:
        raise AssigneeNotEligibleError(
            user_id=int(missing[0]),
            reason="USER_NOT_FOUND",
            message=f"Assignee user {missing[0]} not found",
        )

    for user_id in ids:
        verdict = evaluate_assignee_eligibility(user_map[user_id], service_line=service_line, assignment=assignment)
        if verdict.get("eligible"):
            continue
        raise AssigneeNotEligibleError(
            user_id=int(user_id),
            reason=str(verdict.get("reason") or "ASSIGNEE_NOT_ELIGIBLE"),
            message=str(verdict.get("message") or "Assignee is not eligible"),
        )


def _assignment_assignee_ids(assignment: Assignment) -> set[int]:
    ids: set[int] = set()
    if assignment.assigned_to_user_id:
        ids.add(int(assignment.assigned_to_user_id))
    for link in assignment.assignment_assignees or []:
        if link.user_id:
            ids.add(int(link.user_id))
    return ids


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def build_workload_signals(db: Session, user_ids: Iterable[int], *, now: Optional[datetime] = None) -> dict[int, dict[str, Any]]:
    ids = sorted({int(uid) for uid in user_ids if uid})
    signals: dict[int, dict[str, Any]] = {
        uid: {
            "open_assignments": 0,
            "overdue_tasks": 0,
            "due_soon": 0,
            "last_active_minutes": None,
        }
        for uid in ids
    }
    if not ids:
        return signals

    current = now or _now_utc()
    soon_cutoff = current + timedelta(hours=48)

    open_assignments = (
        db.query(Assignment)
        .filter(
            Assignment.is_deleted.is_(False),
            Assignment.status.in_(OPEN_ASSIGNMENT_STATUSES),
        )
        .all()
    )
    for assignment in open_assignments:
        for user_id in _assignment_assignee_ids(assignment):
            if user_id in signals:
                signals[user_id]["open_assignments"] += 1

    task_rows = (
        db.query(AssignmentTask)
        .filter(AssignmentTask.assigned_to_user_id.in_(ids))
        .all()
    )
    for task in task_rows:
        if not task.assigned_to_user_id:
            continue
        if task.status not in OVERDUE_TASK_STATUSES:
            continue
        if not task.due_at:
            continue
        due_at = task.due_at if task.due_at.tzinfo is not None else task.due_at.replace(tzinfo=timezone.utc)
        uid = int(task.assigned_to_user_id)
        if due_at < current:
            signals[uid]["overdue_tasks"] += 1
        elif current <= due_at <= soon_cutoff:
            signals[uid]["due_soon"] += 1

    activity_rows = (
        db.query(ActivityLog.actor_user_id, func.max(ActivityLog.created_at))
        .filter(ActivityLog.actor_user_id.in_(ids))
        .group_by(ActivityLog.actor_user_id)
        .all()
    )
    for user_id, last_at in activity_rows:
        if not user_id or user_id not in signals or not last_at:
            continue
        timestamp = last_at if last_at.tzinfo is not None else last_at.replace(tzinfo=timezone.utc)
        minutes = int(max((current - timestamp).total_seconds(), 0) // 60)
        signals[int(user_id)]["last_active_minutes"] = minutes

    return signals


def compute_allocation_score(
    *,
    assignment: Assignment,
    user: User,
    policy: dict[str, Any],
    signals: dict[str, Any],
) -> int:
    weights = policy.get("weights") or DEFAULT_ALLOCATION_POLICY["weights"]
    score = 0
    score += int(signals.get("open_assignments") or 0) * int(weights.get("open_assignments", 3))
    score += int(signals.get("overdue_tasks") or 0) * int(weights.get("overdue_tasks", 8))
    score += int(signals.get("due_soon") or 0) * int(weights.get("due_soon", 4))

    last_active_minutes = signals.get("last_active_minutes")
    if last_active_minutes is None or int(last_active_minutes) > INACTIVE_WINDOW_MINUTES:
        score += int(weights.get("inactive_penalty", 6))

    if assignment.site_visit_date and rbac.user_has_role(user, Role.FIELD_VALUER):
        score += int(weights.get("field_valuer_bias", -2))
    return int(score)


def build_allocation_candidates(
    db: Session,
    *,
    assignment: Assignment,
    include_ineligible: bool = True,
) -> list[dict[str, Any]]:
    service_line = assignment.service_line_master
    policy = resolve_allocation_policy(service_line)
    users = db.query(User).filter(User.is_active.is_(True)).all()
    user_ids = [int(user.id) for user in users]
    signals = build_workload_signals(db, user_ids)
    max_open_soft = int(policy.get("max_open_assignments_soft", DEFAULT_ALLOCATION_POLICY["max_open_assignments_soft"]))

    rows: list[dict[str, Any]] = []
    for user in users:
        verdict = evaluate_assignee_eligibility(user, service_line=service_line, assignment=assignment)
        user_signals = signals.get(int(user.id), {"open_assignments": 0, "overdue_tasks": 0, "due_soon": 0, "last_active_minutes": None})
        score = compute_allocation_score(
            assignment=assignment,
            user=user,
            policy=policy,
            signals=user_signals,
        )
        row = {
            "user_id": int(user.id),
            "name": user.full_name or user.email,
            "roles": [role.value for role in rbac.roles_for_user(user)],
            "eligible": bool(verdict.get("eligible")),
            "reason": verdict.get("reason"),
            "score": score,
            "signals": user_signals,
            "overloaded": int(user_signals.get("open_assignments") or 0) > max_open_soft,
        }
        if include_ineligible or row["eligible"]:
            rows.append(row)

    rows.sort(
        key=lambda row: (
            0 if row["eligible"] else 1,
            int(row.get("score", 0)),
            int(row.get("signals", {}).get("open_assignments") or 0),
            str(row.get("name") or "").lower(),
        )
    )
    return rows
