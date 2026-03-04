from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.approval import Approval
from app.models.audit import ActivityLog
from app.models.assignment import Assignment
from app.models.enums import ApprovalStatus, InvoiceStatus, Role, TaskStatus
from app.models.invoice import Invoice
from app.models.task import AssignmentTask
from app.models.user import User
from app.schemas.dashboard import ActivityAssignmentSignal, DashboardActivitySummary, DashboardOverview
from app.services.assignments import apply_access_filter, compute_due_info
from app.services.approvals import is_user_eligible_for_approval
from app.services.dashboard import compute_summary, compute_workload

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _accessible_assignments(db: Session, current_user: User) -> List[Assignment]:
    query = apply_access_filter(
        db.query(Assignment).filter(Assignment.is_deleted.is_(False)),
        current_user,
    )
    return query.all()


@router.get("/overview", response_model=DashboardOverview)
def overview(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> DashboardOverview:
    summary = compute_summary(db, current_user=current_user)
    workload = compute_workload(db, current_user=current_user)

    pending_approvals = (
        db.query(Approval)
        .filter(Approval.status == ApprovalStatus.PENDING)
        .all()
    )
    approvals_pending = len([a for a in pending_approvals if is_user_eligible_for_approval(a, current_user)])

    payments_pending = (
        db.query(Invoice)
        .filter(
            Invoice.is_paid.is_(False),
            Invoice.status.in_([
                InvoiceStatus.DRAFT,
                InvoiceStatus.ISSUED,
                InvoiceStatus.SENT,
                InvoiceStatus.PARTIALLY_PAID,
            ]),
        )
        .count()
    )

    overdue_assignments = sum(1 for a in _accessible_assignments(db, current_user) if compute_due_info(a).due_state == "OVERDUE")

    return DashboardOverview(
        summary=summary,
        workload=workload,
        approvals_pending=approvals_pending,
        payments_pending=payments_pending,
        overdue_assignments=overdue_assignments,
    )


@router.get("/activity-summary", response_model=DashboardActivitySummary)
def activity_summary(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> DashboardActivitySummary:
    if current_user.role == Role.EXTERNAL_PARTNER or Role.EXTERNAL_PARTNER.value in (current_user.roles or []):
        return DashboardActivitySummary(
            assignments_in_progress_count=0,
            active_users_count=0,
            recent_downloads_count=0,
            recent_uploads_count=0,
            generated_at=datetime.now(timezone.utc).isoformat(),
            top_active_assignments=[],
        )

    now = datetime.now(timezone.utc)
    cutoff_active = now - timedelta(hours=1)
    cutoff_recent = now - timedelta(hours=24)

    def _as_utc(value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    accessible_assignments = _accessible_assignments(db, current_user)
    accessible_assignment_ids = {assignment.id for assignment in accessible_assignments}
    assignment_code_map = {assignment.id: assignment.assignment_code for assignment in accessible_assignments}

    if not accessible_assignment_ids:
        return DashboardActivitySummary(
            assignments_in_progress_count=0,
            active_users_count=0,
            recent_downloads_count=0,
            recent_uploads_count=0,
            generated_at=now.isoformat(),
            top_active_assignments=[],
        )

    signal_types = {
        "DOCUMENT_DOWNLOADED",
        "DOCUMENT_UPLOADED",
        "DOCUMENT_VIEWED",
        "DOCUMENT_REVIEWED",
        "MISSING_DOC_REMINDER",
        "TASK_CREATED",
        "TASK_UPDATED",
        "MESSAGE_CREATED",
        "ASSIGNMENT_REASSIGNED",
        "ASSIGNMENT_ASSIGNEES_UPDATED",
        "ASSIGNMENT_FINANCE_UPDATED",
        "ASSIGNMENT_FLOORS_UPDATED",
        "ASSIGNMENT_LAND_SURVEYS_UPDATED",
    }

    recent_logs = (
        db.query(ActivityLog)
        .filter(
            ActivityLog.assignment_id.in_(accessible_assignment_ids),
            ActivityLog.created_at >= cutoff_recent,
        )
        .order_by(ActivityLog.created_at.desc())
        .limit(4000)
        .all()
    )

    open_task_assignment_rows = (
        db.query(AssignmentTask.assignment_id)
        .filter(
            AssignmentTask.assignment_id.in_(accessible_assignment_ids),
            AssignmentTask.status.in_([TaskStatus.TODO, TaskStatus.DOING, TaskStatus.BLOCKED]),
        )
        .distinct()
        .all()
    )
    open_task_assignment_ids = {row[0] for row in open_task_assignment_rows if row[0]}

    active_assignment_ids = {
        log.assignment_id
        for log in recent_logs
        if log.assignment_id and log.type in signal_types
    }
    assignments_in_progress = active_assignment_ids | open_task_assignment_ids

    recent_downloads_count = sum(1 for log in recent_logs if log.type == "DOCUMENT_DOWNLOADED")
    recent_uploads_count = sum(1 for log in recent_logs if log.type == "DOCUMENT_UPLOADED")

    users_active_count = len(
        {
            log.actor_user_id
            for log in recent_logs
            if log.actor_user_id and (created_at := _as_utc(log.created_at)) and created_at >= cutoff_active
        }
    )

    actor_ids = {log.actor_user_id for log in recent_logs if log.actor_user_id}
    actor_map = {
        row.id: (row.full_name or row.email)
        for row in db.query(User).filter(User.id.in_(actor_ids)).all()
    } if actor_ids else {}

    latest_by_assignment: dict[int, ActivityLog] = {}
    for log in recent_logs:
        if not log.assignment_id:
            continue
        if log.assignment_id not in assignments_in_progress:
            continue
        if log.assignment_id not in latest_by_assignment:
            latest_by_assignment[log.assignment_id] = log

    top_active_assignments: list[ActivityAssignmentSignal] = []
    for assignment_id, log in list(latest_by_assignment.items())[:5]:
        action_at = _as_utc(log.created_at)
        top_active_assignments.append(
            ActivityAssignmentSignal(
                assignment_id=assignment_id,
                assignment_code=assignment_code_map.get(assignment_id),
                last_action_at=action_at.isoformat() if action_at else None,
                last_action_type=log.type,
                actor_name=actor_map.get(log.actor_user_id),
            )
        )

    return DashboardActivitySummary(
        assignments_in_progress_count=len(assignments_in_progress),
        active_users_count=users_active_count,
        recent_downloads_count=recent_downloads_count,
        recent_uploads_count=recent_uploads_count,
        generated_at=now.isoformat(),
        top_active_assignments=top_active_assignments,
    )
