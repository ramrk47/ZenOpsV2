from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.approval import Approval
from app.models.assignment import Assignment
from app.models.enums import ApprovalStatus, InvoiceStatus
from app.models.invoice import Invoice
from app.models.user import User
from app.schemas.dashboard import DashboardOverview
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
