from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models.assignment import Assignment
from app.models.enums import NotificationType, Role, TaskStatus
from app.models.task import AssignmentTask
from app.services.assignments import compute_due_info, get_assignment_assignee_ids, is_assignment_open
from app.services.notifications import create_notification_if_absent, notify_roles_if_absent
from app.utils.sla import DUE_SOON_MINUTES


def _now() -> datetime:
    return datetime.now(timezone.utc)


def sweep_assignment_sla(db: Session, *, now: Optional[datetime] = None) -> dict:
    timestamp = now or _now()
    assignments = (
        db.query(Assignment)
        .filter(Assignment.is_deleted.is_(False))
        .all()
    )
    due_soon_sent = 0
    overdue_sent = 0

    for assignment in assignments:
        if not is_assignment_open(assignment.status):
            continue
        due_info = compute_due_info(assignment, now=timestamp)
        payload = {
            "assignment_id": assignment.id,
            "assignment_code": assignment.assignment_code,
            "due_time": due_info.due_time.isoformat() if due_info.due_time else None,
        }
        if due_info.due_state == "DUE_SOON":
            for user_id in get_assignment_assignee_ids(assignment, include_primary=True):
                created = create_notification_if_absent(
                    db,
                    user_id=user_id,
                    notif_type=NotificationType.SLA_DUE_SOON,
                    message=f"Assignment {assignment.assignment_code} is due soon",
                    payload=payload,
                    payload_match={"assignment_id": assignment.id},
                    within_minutes=120,
                )
                if created:
                    due_soon_sent += 1
            notify_roles_if_absent(
                db,
                roles=[Role.OPS_MANAGER],
                notif_type=NotificationType.SLA_DUE_SOON,
                message=f"Assignment {assignment.assignment_code} is due soon",
                payload=payload,
                payload_match={"assignment_id": assignment.id},
                within_minutes=120,
            )
        elif due_info.due_state == "OVERDUE" and due_info.minutes_overdue:
            escalation_role = due_info.escalation_role
            roles = [Role.OPS_MANAGER] if escalation_role == "OPS_MANAGER" else [Role.ADMIN]
            created = notify_roles_if_absent(
                db,
                roles=roles,
                notif_type=NotificationType.SLA_OVERDUE,
                message=f"Assignment {assignment.assignment_code} is overdue ({due_info.minutes_overdue}m)",
                payload=payload | {"minutes_overdue": due_info.minutes_overdue},
                payload_match={"assignment_id": assignment.id},
                within_minutes=360,
            )
            overdue_sent += len(created)

    return {"sla_due_soon": due_soon_sent, "sla_overdue": overdue_sent}


def sweep_task_due(db: Session, *, now: Optional[datetime] = None) -> dict:
    timestamp = now or _now()
    tasks = (
        db.query(AssignmentTask)
        .filter(AssignmentTask.due_at.is_not(None))
        .all()
    )
    due_soon_sent = 0
    overdue_sent = 0
    for task in tasks:
        if task.status == TaskStatus.DONE:
            continue
        if not task.due_at:
            continue
        minutes_left = int((task.due_at - timestamp).total_seconds() // 60)
        payload = {
            "task_id": task.id,
            "assignment_id": task.assignment_id,
            "due_at": task.due_at.isoformat(),
        }
        if minutes_left < 0:
            if task.assigned_to_user_id:
                created = create_notification_if_absent(
                    db,
                    user_id=task.assigned_to_user_id,
                    notif_type=NotificationType.TASK_OVERDUE,
                    message=f"Task overdue: {task.title}",
                    payload=payload,
                    payload_match={"task_id": task.id},
                    within_minutes=180,
                )
                if created:
                    overdue_sent += 1
            notify_roles_if_absent(
                db,
                roles=[Role.OPS_MANAGER, Role.ADMIN],
                notif_type=NotificationType.TASK_OVERDUE,
                message=f"Task overdue: {task.title}",
                payload=payload,
                payload_match={"task_id": task.id},
                within_minutes=360,
            )
        elif minutes_left <= DUE_SOON_MINUTES:
            if task.assigned_to_user_id:
                created = create_notification_if_absent(
                    db,
                    user_id=task.assigned_to_user_id,
                    notif_type=NotificationType.TASK_DUE_SOON,
                    message=f"Task due soon: {task.title}",
                    payload=payload,
                    payload_match={"task_id": task.id},
                    within_minutes=120,
                )
                if created:
                    due_soon_sent += 1
    return {"task_due_soon": due_soon_sent, "task_overdue": overdue_sent}


def run_notification_sweep(db: Session, *, now: Optional[datetime] = None) -> dict:
    timestamp = now or _now()
    result = {
        "timestamp": timestamp.isoformat(),
        "assignment": sweep_assignment_sla(db, now=timestamp),
        "tasks": sweep_task_due(db, now=timestamp),
    }
    return result
