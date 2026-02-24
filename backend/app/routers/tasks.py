from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.deps import get_current_user
from app.core.guards import require_destructive_allowed
from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.calendar import CalendarEvent
from app.models.enums import NotificationType
from app.models.task import AssignmentTask
from app.models.user import User
from app.schemas.task import TaskCreate, TaskRead, TaskUpdate
from app.services.activity import log_activity
from app.services.calendar import upsert_task_due_event
from app.services.assignments import ensure_assignment_access
from app.services.notifications import create_notification
from app.services.leave import current_leave

router = APIRouter(prefix="/api/assignments/{assignment_id}/tasks", tags=["tasks"])


def _get_assignment_or_404(db: Session, assignment_id: int) -> Assignment:
    assignment = db.get(Assignment, assignment_id)
    if not assignment or assignment.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return assignment


def _require_access(assignment: Assignment, user: User) -> None:
    try:
        ensure_assignment_access(assignment, user)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.get("", response_model=List[TaskRead])
def list_tasks(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[TaskRead]:
    assignment = _get_assignment_or_404(db, assignment_id)
    _require_access(assignment, current_user)
    return [TaskRead.model_validate(t) for t in assignment.tasks]


@router.post("", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
def create_task(
    assignment_id: int,
    task_in: TaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskRead:
    assignment = _get_assignment_or_404(db, assignment_id)
    _require_access(assignment, current_user)

    if task_in.assigned_to_user_id and not task_in.override_on_leave:
        leave = current_leave(db, user_id=int(task_in.assigned_to_user_id))
        if leave:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "Assignee is currently on approved leave",
                    "user_id": task_in.assigned_to_user_id,
                    "leave_request_id": leave.id,
                    "leave_start": leave.start_date.isoformat(),
                    "leave_end": (leave.end_date or leave.start_date).isoformat(),
                },
            )

    task = AssignmentTask(
        assignment_id=assignment_id,
        title=task_in.title,
        description=task_in.description,
        status=task_in.status,
        assigned_to_user_id=task_in.assigned_to_user_id,
        due_at=task_in.due_at,
        created_by_user_id=current_user.id,
        template_type=task_in.template_type,
        updated_at=datetime.now(timezone.utc),
    )
    db.add(task)
    db.flush()

    upsert_task_due_event(db, task=task, assignment=assignment, actor_user_id=current_user.id)

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="TASK_CREATED",
        assignment_id=assignment.id,
        message=f"Task created: {task.title}",
        payload={"task_id": task.id},
    )

    if task.assigned_to_user_id and task.assigned_to_user_id != current_user.id:
        create_notification(
            db,
            user_id=task.assigned_to_user_id,
            notif_type=NotificationType.TASK_ASSIGNED,
            message=f"Task assigned: {task.title}",
            payload={"task_id": task.id, "assignment_id": assignment.id},
        )

    db.commit()
    db.refresh(task)
    return TaskRead.model_validate(task)


@router.patch("/{task_id}", response_model=TaskRead)
def update_task(
    assignment_id: int,
    task_id: int,
    task_update: TaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TaskRead:
    assignment = _get_assignment_or_404(db, assignment_id)
    _require_access(assignment, current_user)

    task = db.get(AssignmentTask, task_id)
    if not task or task.assignment_id != assignment_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    capabilities = rbac.get_capabilities_for_user(current_user)
    if task.created_by_user_id != current_user.id and task.assigned_to_user_id != current_user.id:
        if not capabilities.get("view_all_assignments"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted to modify this task")

    update_data = task_update.model_dump(exclude_unset=True)
    override_on_leave = bool(update_data.pop("override_on_leave", False))
    new_assignee_id = update_data.get("assigned_to_user_id") if "assigned_to_user_id" in update_data else None
    if new_assignee_id and not override_on_leave:
        leave = current_leave(db, user_id=int(new_assignee_id))
        if leave:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "Assignee is currently on approved leave",
                    "user_id": new_assignee_id,
                    "leave_request_id": leave.id,
                    "leave_start": leave.start_date.isoformat(),
                    "leave_end": (leave.end_date or leave.start_date).isoformat(),
                },
            )
    previous_assignee = task.assigned_to_user_id
    previous_status = task.status
    for field, value in update_data.items():
        if field == "assigned_to_user_id" and value is not None and not capabilities.get("reassign"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted to reassign tasks")
        setattr(task, field, value)

    task.updated_at = datetime.now(timezone.utc)
    db.add(task)
    db.flush()

    upsert_task_due_event(db, task=task, assignment=assignment, actor_user_id=current_user.id)

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="TASK_UPDATED",
        assignment_id=assignment.id,
        message=f"Task updated: {task.title}",
        payload={"task_id": task.id},
    )

    notify_assignee = task.assigned_to_user_id and task.assigned_to_user_id != current_user.id
    if notify_assignee:
        if task.assigned_to_user_id != previous_assignee:
            create_notification(
                db,
                user_id=task.assigned_to_user_id,
                notif_type=NotificationType.TASK_ASSIGNED,
                message=f"Task assigned: {task.title}",
                payload={"task_id": task.id, "assignment_id": assignment.id},
            )
        elif task.status != previous_status or any(field in update_data for field in ["due_at", "title", "description"]):
            create_notification(
                db,
                user_id=task.assigned_to_user_id,
                notif_type=NotificationType.TASK_UPDATED,
                message=f"Task updated: {task.title}",
                payload={"task_id": task.id, "assignment_id": assignment.id},
            )

    db.commit()
    db.refresh(task)
    return TaskRead.model_validate(task)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    assignment_id: int,
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    require_destructive_allowed("delete_task")
    assignment = _get_assignment_or_404(db, assignment_id)
    _require_access(assignment, current_user)

    task = db.get(AssignmentTask, task_id)
    if not task or task.assignment_id != assignment_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    capabilities = rbac.get_capabilities_for_user(current_user)
    if task.created_by_user_id != current_user.id and not capabilities.get("view_all_assignments"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted to delete this task")

    if task.calendar_event_id:
        event = db.get(CalendarEvent, task.calendar_event_id)
        if event:
            db.delete(event)

    db.delete(task)
    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="TASK_DELETED",
        assignment_id=assignment.id,
        message=f"Task deleted: {task.title}",
        payload={"task_id": task.id},
    )
    db.commit()
    return None
