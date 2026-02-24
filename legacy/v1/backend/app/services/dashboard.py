from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Set

from sqlalchemy.orm import Session

from app.core import rbac
from app.models.assignment import Assignment
from app.models.enums import AssignmentStatus
from app.models.user import User
from app.schemas.assignment import AssignmentSummary, UserWorkload, WorkloadBucket
from app.services.assignments import apply_access_filter, compute_due_info, get_assignment_assignee_ids, is_assignment_open
from app.services.leave import users_on_leave
from app.utils.sla import bucket_due_state


def _base_query(db: Session):
    return db.query(Assignment).filter(Assignment.is_deleted.is_(False))


def compute_summary(db: Session, *, current_user: User) -> AssignmentSummary:
    query = apply_access_filter(_base_query(db), current_user)
    assignments = query.all()

    total = len(assignments)
    completed = sum(1 for a in assignments if a.status == AssignmentStatus.COMPLETED)
    pending = sum(1 for a in assignments if is_assignment_open(a.status))
    unpaid = sum(1 for a in assignments if not a.is_paid)
    overdue = sum(1 for a in assignments if compute_due_info(a).due_state == "OVERDUE")

    return AssignmentSummary(total=total, pending=pending, completed=completed, unpaid=unpaid, overdue=overdue)


def _collect_users(db: Session, user_ids: Iterable[Optional[int]]) -> Dict[int, User]:
    ids = sorted({uid for uid in user_ids if uid is not None})
    if not ids:
        return {}
    users = db.query(User).filter(User.id.in_(ids)).all()
    return {u.id: u for u in users}


def compute_workload(db: Session, *, current_user: User) -> List[UserWorkload]:
    query = apply_access_filter(_base_query(db), current_user)
    assignments = [a for a in query.all() if is_assignment_open(a.status)]
    leave_today: Set[int] = users_on_leave(db)

    buckets: dict[Optional[int], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    totals: dict[Optional[int], int] = defaultdict(int)

    for assignment in assignments:
        due_info = compute_due_info(assignment)
        state_bucket = bucket_due_state(due_info.due_state)
        assignee_ids = get_assignment_assignee_ids(assignment, include_primary=True)
        if not assignee_ids:
            buckets[None][state_bucket] += 1
            totals[None] += 1
            continue
        for user_id in assignee_ids:
            buckets[user_id][state_bucket] += 1
            totals[user_id] += 1

    user_map = _collect_users(db, totals.keys())

    workload: List[UserWorkload] = []
    for user_id, state_counts in buckets.items():
        user = user_map.get(user_id) if user_id is not None else None
        overdue = state_counts.get("OVERDUE", 0)
        due_soon = state_counts.get("DUE_SOON", 0)
        ok = state_counts.get("OK", 0)
        bucket_models = [WorkloadBucket(due_state=state, count=count) for state, count in sorted(state_counts.items())]
        workload.append(
            UserWorkload(
                user_id=user_id,
                user_email=user.email if user else None,
                user_name=user.full_name if user else "Unassigned",
                on_leave_today=(user_id in leave_today) if user_id is not None else False,
                total_open=totals[user_id],
                overdue=overdue,
                due_soon=due_soon,
                ok=ok,
                buckets=bucket_models,
            )
        )

    workload.sort(key=lambda w: (w.on_leave_today, -w.overdue, -w.total_open, w.user_name or ""))
    return workload
