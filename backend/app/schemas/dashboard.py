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
