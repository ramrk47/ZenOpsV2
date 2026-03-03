from __future__ import annotations

from typing import List

from app.schemas.assignment import AssignmentSummary, UserWorkload
from app.schemas.base import ORMModel


class DashboardOverview(ORMModel):
    summary: AssignmentSummary
    workload: List[UserWorkload]
    approvals_pending: int
    payments_pending: int
    overdue_assignments: int


class ActivityAssignmentSignal(ORMModel):
    assignment_id: int
    assignment_code: str | None = None
    last_action_at: str | None = None
    last_action_type: str | None = None
    actor_name: str | None = None


class DashboardActivitySummary(ORMModel):
    assignments_in_progress_count: int
    active_users_count: int
    recent_downloads_count: int
    recent_uploads_count: int
    generated_at: str
    top_active_assignments: List[ActivityAssignmentSignal]
