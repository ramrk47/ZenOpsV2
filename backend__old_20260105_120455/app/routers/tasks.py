"""
Task routes.

CRUD operations on tasks belonging to assignments.
"""

from __future__ import annotations

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..dependencies import get_db, get_current_active_user, require_capability
from ..models.assignment import Assignment
from ..models.task import AssignmentTask
from ..models.user import User
from ..utils import rbac
from ..schemas.task import TaskCreate, TaskRead, TaskUpdate

router = APIRouter(prefix="/api/assignments/{assignment_id}/tasks", tags=["tasks"])


def _get_assignment_for_task(db: Session, assignment_id: int) -> Assignment:
    assignment = db.get(Assignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return assignment


@router.get("/", response_model=list[TaskRead])
def list_tasks(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    assignment = _get_assignment_for_task(db, assignment_id)
    if not rbac.user_has_capability(current_user, "tasks.manage") and not (
        assignment.created_by_user_id == current_user.id or assignment.assigned_to_user_id == current_user.id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to view tasks")
    return [TaskRead.from_orm(t) for t in assignment.tasks]


@router.post("/", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
def create_task(
    assignment_id: int,
    task_in: TaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    assignment = _get_assignment_for_task(db, assignment_id)
    if not rbac.user_has_capability(current_user, "tasks.manage") and not (
        assignment.created_by_user_id == current_user.id or assignment.assigned_to_user_id == current_user.id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to create tasks")
    task = AssignmentTask(
        assignment_id=assignment.id,
        title=task_in.title,
        description=task_in.description,
        status=task_in.status,
        assigned_to_user_id=task_in.assigned_to_user_id,
        due_at=task_in.due_at,
        template_type=task_in.template_type,
        created_by_user_id=current_user.id,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return TaskRead.from_orm(task)


@router.patch("/{task_id}", response_model=TaskRead)
def update_task(
    assignment_id: int,
    task_id: int,
    task_update: TaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    assignment = _get_assignment_for_task(db, assignment_id)
    task = db.get(AssignmentTask, task_id)
    if not task or task.assignment_id != assignment.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if not rbac.user_has_capability(current_user, "tasks.manage") and not (
        assignment.created_by_user_id == current_user.id or assignment.assigned_to_user_id == current_user.id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to update task")
    data = task_update.dict(exclude_unset=True)
    for field, value in data.items():
        setattr(task, field, value)
    task.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(task)
    return TaskRead.from_orm(task)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    assignment_id: int,
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    assignment = _get_assignment_for_task(db, assignment_id)
    task = db.get(AssignmentTask, task_id)
    if not task or task.assignment_id != assignment.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if not rbac.user_has_capability(current_user, "tasks.manage") and not (
        assignment.created_by_user_id == current_user.id or assignment.assigned_to_user_id == current_user.id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to delete task")
    db.delete(task)
    db.commit()
    return