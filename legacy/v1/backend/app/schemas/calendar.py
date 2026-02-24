from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import Field, model_validator, field_validator

from app.models.enums import CalendarEventType
from app.schemas.base import ORMModel


class CalendarEventBase(ORMModel):
    event_type: CalendarEventType
    event_label_id: Optional[int] = None
    title: str
    description: Optional[str] = None
    start_at: datetime
    end_at: datetime
    all_day: bool = False
    assignment_id: Optional[int] = None
    assigned_to_user_id: Optional[int] = None
    assigned_to_all: bool = False
    assigned_user_ids: List[int] = Field(default_factory=list)
    payload_json: Optional[dict] = None

    @field_validator("assigned_user_ids", mode="before")
    @classmethod
    def coerce_assignee_list(cls, value):
        if value is None:
            return []
        return value

    @model_validator(mode="after")
    def validate_dates_and_assignees(self, info) -> "CalendarEventBase":
        if info.context and info.context.get("skip_validation"):
            return self
        if self.end_at < self.start_at:
            raise ValueError("end_at cannot be before start_at")
        if self.assigned_to_all:
            self.assigned_user_ids = []
            self.assigned_to_user_id = None
            return self
        ids = set(self.assigned_user_ids or [])
        if self.assigned_to_user_id:
            ids.add(int(self.assigned_to_user_id))
        self.assigned_user_ids = sorted(ids)
        return self


class CalendarEventCreate(CalendarEventBase):
    pass


class CalendarEventUpdate(ORMModel):
    event_type: Optional[CalendarEventType] = None
    event_label_id: Optional[int] = None
    title: Optional[str] = None
    description: Optional[str] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    all_day: Optional[bool] = None
    assignment_id: Optional[int] = None
    assigned_to_user_id: Optional[int] = None
    assigned_to_all: Optional[bool] = None
    assigned_user_ids: Optional[List[int]] = None
    payload_json: Optional[dict] = None

    @model_validator(mode="after")
    def validate_dates(self) -> "CalendarEventUpdate":
        if self.start_at and self.end_at and self.end_at < self.start_at:
            raise ValueError("end_at cannot be before start_at")
        return self


class CalendarEventRead(CalendarEventBase):
    id: int
    created_by_user_id: int
    event_label_name: Optional[str] = None
    related_leave_request_id: Optional[int] = None
    assignment_code: Optional[str] = None
    created_at: datetime
    updated_at: datetime
