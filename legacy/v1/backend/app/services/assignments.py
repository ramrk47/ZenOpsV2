from __future__ import annotations

from collections import OrderedDict
from datetime import datetime, timezone
from decimal import Decimal
from typing import Iterable, Optional, Sequence, Set

from sqlalchemy import or_, select
from sqlalchemy.orm import Query, Session

from app.core import rbac
from app.models.assignment import Assignment
from app.models.assignment_assignee import AssignmentAssignee
from app.models.assignment_floor import AssignmentFloorArea
from app.models.enums import AssignmentStatus, CaseType, NotificationType, Role
from app.models.master import DocumentChecklistTemplate, PropertySubtype
from app.models.user import User
from app.schemas.assignment import AssignmentFloorCreate, DueInfo
from app.services.notifications import create_notification, create_notification_if_absent, notify_roles, notify_roles_if_absent
from app.utils import sla


def generate_assignment_code(db: Session) -> str:
    """Generate a short, human-friendly assignment code."""
    today = datetime.now(timezone.utc)
    date_part = today.strftime("%y%m")
    prefix = f"Z-{date_part}-"
    month_count = db.query(Assignment).filter(Assignment.assignment_code.like(f"{prefix}%")).count()
    seq = month_count + 1
    return f"{prefix}{seq:04d}"


def _assignee_subquery(user_id: int):
    return select(AssignmentAssignee.assignment_id).where(AssignmentAssignee.user_id == user_id)


def apply_access_filter(query: Query, user: User) -> Query:
    capabilities = rbac.get_capabilities_for_user(user)
    if not capabilities.get("view_all_assignments"):
        assignee_ids = _assignee_subquery(user.id)
        query = query.filter(
            or_(
                Assignment.assigned_to_user_id == user.id,
                Assignment.created_by_user_id == user.id,
                Assignment.id.in_(assignee_ids),
            )
        )
    return query


def ensure_assignment_access(assignment: Assignment, user: User) -> None:
    capabilities = rbac.get_capabilities_for_user(user)
    if assignment.is_deleted:
        raise PermissionError("Assignment is deleted")
    if capabilities.get("view_all_assignments"):
        return
    if assignment.assigned_to_user_id == user.id or assignment.created_by_user_id == user.id:
        return
    assignee_ids = {link.user_id for link in assignment.assignment_assignees or []}
    if user.id in assignee_ids:
        return
    raise PermissionError("Not authorized to access this assignment")


def compute_due_info(assignment: Assignment, now: Optional[datetime] = None) -> DueInfo:
    due_time = sla.compute_due_time(assignment.created_at, assignment.site_visit_date, assignment.report_due_date)
    due_state, minutes_left, minutes_overdue = sla.compute_due_state(due_time, now=now)
    escalation_role, escalation_reason = sla.compute_escalation(minutes_overdue)
    return DueInfo(
        due_time=due_time,
        due_state=due_state,
        minutes_left=minutes_left,
        minutes_overdue=minutes_overdue,
        escalation_role=escalation_role,
        escalation_reason=escalation_reason,
    )


def _template_matches(assignment: Assignment, template: DocumentChecklistTemplate) -> bool:
    if template.bank_id and template.bank_id != assignment.bank_id:
        return False
    if template.branch_id and template.branch_id != assignment.branch_id:
        return False
    if template.property_type_id and template.property_type_id != assignment.property_type_id:
        return False
    if template.property_subtype_id and template.property_subtype_id != assignment.property_subtype_id:
        return False
    if template.case_type and template.case_type != assignment.case_type:
        return False
    return True


def _specificity_score(template: DocumentChecklistTemplate) -> int:
    score = 0
    score += 8 if template.bank_id else 0
    score += 6 if template.branch_id else 0
    score += 5 if template.property_subtype_id else 0
    score += 4 if template.property_type_id else 0
    score += 2 if template.case_type else 0
    return score


def get_required_document_categories(db: Session, assignment: Assignment) -> list[str]:
    templates: Iterable[DocumentChecklistTemplate] = db.query(DocumentChecklistTemplate).all()
    applicable = [t for t in templates if _template_matches(assignment, t)]

    # Prefer more specific templates first; keep order stable.
    applicable.sort(key=_specificity_score, reverse=True)

    categories: "OrderedDict[str, None]" = OrderedDict()
    for template in applicable:
        categories.setdefault(template.category.strip(), None)

    if categories:
        return list(categories.keys())

    # Sensible defaults when no templates exist.
    if assignment.case_type == CaseType.BANK:
        return ["Application", "EC", "Sale Deed", "Photos", "Draft Report", "Final Report"]
    return ["Client Request", "Photos", "Draft Report", "Final Report"]


def compute_missing_document_categories(db: Session, assignment: Assignment) -> list[str]:
    required = set(get_required_document_categories(db, assignment))
    present = {d.category for d in assignment.documents if d.category}
    missing = sorted(required - present)
    return missing


def get_assignment_assignee_ids(assignment: Assignment, *, include_primary: bool = True) -> list[int]:
    ids: Set[int] = set()
    if include_primary and assignment.assigned_to_user_id:
        ids.add(int(assignment.assigned_to_user_id))
    for link in assignment.assignment_assignees or []:
        if link.user_id:
            ids.add(int(link.user_id))
    return sorted(ids)


def sync_assignment_assignees(
    db: Session,
    assignment: Assignment,
    assignee_user_ids: Optional[Sequence[int]],
) -> list[int]:
    if assignee_user_ids is None:
        return get_assignment_assignee_ids(assignment, include_primary=True)

    target_ids: Set[int] = {int(uid) for uid in assignee_user_ids if uid}
    if assignment.assigned_to_user_id:
        target_ids.add(int(assignment.assigned_to_user_id))

    existing_links = {int(link.user_id): link for link in assignment.assignment_assignees or []}

    # Remove links not in the target set.
    for user_id, link in list(existing_links.items()):
        if user_id not in target_ids:
            db.delete(link)

    # Add missing links.
    for user_id in sorted(target_ids):
        if user_id in existing_links:
            continue
        db.add(AssignmentAssignee(assignment_id=assignment.id, user_id=user_id))

    db.flush()
    return sorted(target_ids)


def _decimal(value: Decimal | float | int | str) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def sync_assignment_floors(
    db: Session,
    assignment: Assignment,
    floors_payload: Optional[Sequence[AssignmentFloorCreate | dict]],
) -> Decimal | None:
    if floors_payload is None:
        return None

    # Clear existing floors to keep the model simple and deterministic.
    for floor in list(assignment.floors or []):
        db.delete(floor)
    db.flush()

    total = Decimal("0.00")
    for idx, floor in enumerate(floors_payload):
        payload = floor.model_dump() if hasattr(floor, "model_dump") else dict(floor)
        area = _decimal(payload["area"])
        total += area
        db.add(
            AssignmentFloorArea(
                assignment_id=assignment.id,
                floor_name=str(payload["floor_name"]).strip(),
                area=area,
                order_index=int(payload.get("order_index", idx)),
            )
        )
    db.flush()
    return total.quantize(Decimal("0.01"))


def notify_assignment_assignees(
    db: Session,
    assignment: Assignment,
    *,
    notif_type: NotificationType,
    message: str,
    payload: Optional[dict] = None,
    exclude_user_ids: Optional[Sequence[int]] = None,
) -> None:
    excluded = {int(uid) for uid in (exclude_user_ids or [])}
    for user_id in get_assignment_assignee_ids(assignment, include_primary=True):
        if user_id in excluded:
            continue
        create_notification(
            db,
            user_id=user_id,
            notif_type=notif_type,
            message=message,
            payload=payload,
        )


def validate_property_subtype(db: Session, *, property_type_id: Optional[int], property_subtype_id: Optional[int]) -> None:
    if not property_subtype_id:
        return
    subtype = db.get(PropertySubtype, property_subtype_id)
    if not subtype:
        raise ValueError("Invalid property_subtype_id")
    if property_type_id and subtype.property_type_id != property_type_id:
        raise ValueError("property_subtype_id does not belong to property_type_id")


def maybe_emit_due_soon_notifications(db: Session, assignment: Assignment, due_info: DueInfo) -> None:
    if due_info.due_state != "DUE_SOON":
        return
    payload = {"assignment_id": assignment.id, "assignment_code": assignment.assignment_code}
    for user_id in get_assignment_assignee_ids(assignment, include_primary=True):
        create_notification_if_absent(
            db,
            user_id=user_id,
            notif_type=NotificationType.SLA_DUE_SOON,
            message=f"Assignment {assignment.assignment_code} is due soon",
            payload=payload,
            payload_match={"assignment_id": assignment.id},
            within_minutes=120,
        )
    notify_roles_if_absent(
        db,
        roles=[Role.OPS_MANAGER],
        notif_type=NotificationType.SLA_DUE_SOON,
        message=f"Assignment {assignment.assignment_code} is due soon",
        payload=payload,
        payload_match={"assignment_id": assignment.id},
        within_minutes=120,
    )


def maybe_emit_overdue_notifications(db: Session, assignment: Assignment, due_info: DueInfo) -> None:
    if due_info.due_state != "OVERDUE" or not due_info.minutes_overdue:
        return
    escalation_role = due_info.escalation_role
    if not escalation_role:
        return
    message = f"Assignment {assignment.assignment_code} is overdue ({due_info.minutes_overdue}m)"
    roles = [Role.OPS_MANAGER] if escalation_role == "OPS_MANAGER" else [Role.ADMIN]
    notify_roles_if_absent(
        db,
        roles=roles,
        notif_type=NotificationType.SLA_OVERDUE,
        message=message,
        payload={"assignment_id": assignment.id, "assignment_code": assignment.assignment_code},
        payload_match={"assignment_id": assignment.id},
        within_minutes=360,
    )


def is_assignment_open(status: AssignmentStatus) -> bool:
    return status not in {AssignmentStatus.COMPLETED, AssignmentStatus.CANCELLED}
