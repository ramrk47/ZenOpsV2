from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.task import AssignmentTask
from app.models.user import User
from app.models.enums import TaskStatus
from app.schemas.task import TaskWithAssignment

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("/my", response_model=List[TaskWithAssignment])
def list_my_tasks(
    status: Optional[TaskStatus] = Query(None),
    due_from: Optional[datetime] = Query(None),
    due_to: Optional[datetime] = Query(None),
    include_done: bool = Query(False),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[TaskWithAssignment]:
    query = (
        db.query(AssignmentTask)
        .join(Assignment, Assignment.id == AssignmentTask.assignment_id)
        .filter(
            AssignmentTask.assigned_to_user_id == current_user.id,
            Assignment.is_deleted.is_(False),
        )
    )

    if status:
        query = query.filter(AssignmentTask.status == status)
    elif not include_done:
        query = query.filter(AssignmentTask.status != TaskStatus.DONE)

    if due_from:
        query = query.filter(AssignmentTask.due_at >= due_from)
    if due_to:
        query = query.filter(AssignmentTask.due_at <= due_to)

    tasks = query.order_by(AssignmentTask.due_at.asc().nulls_last(), AssignmentTask.created_at.desc()).limit(limit).all()

    results = []
    for task in tasks:
        assignment = task.assignment
        payload = TaskWithAssignment.model_validate(task).model_dump()
        payload["assignment_code"] = assignment.assignment_code if assignment else None
        payload["assignment_status"] = assignment.status if assignment else None
        payload["borrower_name"] = assignment.borrower_name if assignment else None
        results.append(TaskWithAssignment(**payload))
    return results


@router.get("/queue", response_model=List[TaskWithAssignment])
def list_task_queue(
    status: Optional[TaskStatus] = Query(None),
    unassigned_only: bool = Query(False),
    assigned_to_user_id: Optional[int] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[TaskWithAssignment]:
    capabilities = rbac.get_capabilities_for_user(current_user)
    if not capabilities.get("view_all_assignments"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to view task queue")

    query = (
        db.query(AssignmentTask)
        .join(Assignment, Assignment.id == AssignmentTask.assignment_id)
        .filter(Assignment.is_deleted.is_(False))
    )

    if status:
        query = query.filter(AssignmentTask.status == status)
    else:
        query = query.filter(AssignmentTask.status == TaskStatus.BLOCKED)

    if unassigned_only:
        query = query.filter(AssignmentTask.assigned_to_user_id.is_(None))
    if assigned_to_user_id:
        query = query.filter(AssignmentTask.assigned_to_user_id == assigned_to_user_id)

    tasks = query.order_by(AssignmentTask.updated_at.desc()).limit(limit).all()
    results: list[TaskWithAssignment] = []
    for task in tasks:
        assignment = task.assignment
        payload = TaskWithAssignment.model_validate(task).model_dump()
        payload["assignment_code"] = assignment.assignment_code if assignment else None
        payload["assignment_status"] = assignment.status if assignment else None
        payload["borrower_name"] = assignment.borrower_name if assignment else None
        results.append(TaskWithAssignment(**payload))
    return results
