from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import Field

from app.models.enums import TaskStatus
from app.models.enums import AssignmentStatus
from app.schemas.base import ORMModel


class TaskBase(ORMModel):
    title: str = Field(..., min_length=2, max_length=255)
    description: Optional[str] = None
    status: TaskStatus = TaskStatus.TODO
    assigned_to_user_id: Optional[int] = None
    due_at: Optional[datetime] = None
    template_type: Optional[str] = None


class TaskCreate(TaskBase):
    override_on_leave: bool = False


class TaskUpdate(ORMModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=255)
    description: Optional[str] = None
    status: Optional[TaskStatus] = None
    assigned_to_user_id: Optional[int] = None
    due_at: Optional[datetime] = None
    template_type: Optional[str] = None
    override_on_leave: Optional[bool] = None


class TaskRead(TaskBase):
    id: int
    assignment_id: int
    created_by_user_id: int
    calendar_event_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime


class TaskWithAssignment(TaskRead):
    assignment_code: Optional[str] = None
    assignment_status: Optional[AssignmentStatus] = None
    borrower_name: Optional[str] = None
