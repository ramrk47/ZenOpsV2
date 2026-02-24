"""
Task schemas.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel

from ..models.task import TaskStatus


class TaskBase(BaseModel):
    title: str
    description: Optional[str] = None
    status: TaskStatus = TaskStatus.TODO
    assigned_to_user_id: Optional[int] = None
    due_at: Optional[datetime] = None
    template_type: Optional[str] = None

    class Config:
        from_attributes = True


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[TaskStatus] = None
    assigned_to_user_id: Optional[int] = None
    due_at: Optional[datetime] = None
    template_type: Optional[str] = None

    class Config:
        from_attributes = True


class TaskRead(TaskBase):
    id: int
    assignment_id: int
    created_by_user_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True