"""
Calendar routes.

CRUD operations for calendar events.  Leave events are created
automatically by the leave router, so manual creation is mostly for site
visits, report due dates and internal meetings.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from ..dependencies import get_db, get_current_active_user
from ..models.calendar import CalendarEvent
from ..models.user import User
from ..utils import rbac
from ..schemas.calendar import CalendarEventCreate, CalendarEventRead

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


@router.get("/events", response_model=list[CalendarEventRead])
def list_events(
    assignment_id: int | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    query = db.query(CalendarEvent)
    if assignment_id:
        query = query.filter(CalendarEvent.assignment_id == assignment_id)
    # restrict for non‑managers: only events created by or assigned to user
    if not rbac.user_has_capability(current_user, "calendar.manage"):
        query = query.filter(
            (CalendarEvent.created_by_user_id == current_user.id)
            | (CalendarEvent.assigned_to_user_id == current_user.id)
        )
    events = query.all()
    return [CalendarEventRead.from_orm(e) for e in events]


@router.post("/events", response_model=CalendarEventRead, status_code=status.HTTP_201_CREATED)
def create_event(
    event_in: CalendarEventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if not rbac.user_has_capability(current_user, "calendar.manage"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to create events")
    ce = CalendarEvent(
        event_type=event_in.event_type,
        title=event_in.title,
        start_at=event_in.start_at,
        end_at=event_in.end_at,
        assignment_id=event_in.assignment_id,
        assigned_to_user_id=event_in.assigned_to_user_id,
        created_by_user_id=current_user.id,
    )
    db.add(ce)
    db.commit()
    db.refresh(ce)
    return CalendarEventRead.from_orm(ce)