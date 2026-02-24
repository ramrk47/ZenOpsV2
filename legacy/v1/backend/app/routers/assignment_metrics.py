from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.assignment import AssignmentSummary, UserWorkload
from app.services.dashboard import compute_summary, compute_workload

router = APIRouter(prefix="/api/assignments", tags=["assignments"])


@router.get("/summary", response_model=AssignmentSummary)
def get_assignment_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentSummary:
    return compute_summary(db, current_user=current_user)


@router.get("/workload", response_model=List[UserWorkload])
def get_assignment_workload(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[UserWorkload]:
    return compute_workload(db, current_user=current_user)
