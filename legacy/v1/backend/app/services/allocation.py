from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Optional

from sqlalchemy.orm import Session

from app.core import rbac
from app.models.assignment import Assignment
from app.models.enums import Role
from app.models.master import ServiceLineMaster
from app.models.user import User

DEFAULT_ALLOCATION_POLICY: dict[str, Any] = {
    "eligible_roles": ["ADMIN", "OPS_MANAGER", "ASSISTANT_VALUER", "FIELD_VALUER", "EMPLOYEE"],
    "deny_roles": ["FINANCE", "HR"],
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
    }


def normalize_allocation_policy(policy_json: Optional[dict[str, Any]]) -> dict[str, Any]:
    payload = policy_json or {}
    eligible_roles = _normalize_role_list(payload.get("eligible_roles")) or list(DEFAULT_ALLOCATION_POLICY["eligible_roles"])
    deny_roles = _normalize_role_list(payload.get("deny_roles")) or list(DEFAULT_ALLOCATION_POLICY["deny_roles"])
    return {
        "eligible_roles": eligible_roles,
        "deny_roles": deny_roles,
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
