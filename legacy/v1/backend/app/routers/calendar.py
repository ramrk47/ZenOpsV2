from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Sequence

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.deps import get_current_user
from app.core.guards import require_destructive_allowed
from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.calendar import CalendarEvent
from app.models.enums import CalendarEventType, Role
from app.models.master import CalendarEventLabel
from app.models.user import User
from app.schemas.calendar import CalendarEventCreate, CalendarEventRead, CalendarEventUpdate
from app.services.assignments import ensure_assignment_access

router = APIRouter(prefix="/api/calendar/events", tags=["calendar"])


def _get_event_or_404(db: Session, event_id: int) -> CalendarEvent:
    event = db.get(CalendarEvent, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendar event not found")
    return event


def _assignment_or_none(db: Session, assignment_id: Optional[int]) -> Optional[Assignment]:
    if not assignment_id:
        return None
    assignment = db.get(Assignment, assignment_id)
    if not assignment or assignment.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return assignment


def _label_or_none(db: Session, label_id: Optional[int]) -> Optional[CalendarEventLabel]:
    if not label_id:
        return None
    label = db.get(CalendarEventLabel, label_id)
    if not label:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid calendar event label")
    return label


def _can_view_event(db: Session, event: CalendarEvent, user: User) -> bool:
    from app.core import rbac

    capabilities = rbac.get_capabilities_for_user(user)
    if capabilities.get("view_all_assignments"):
        return True
    if event.assigned_to_all:
        return True
    if event.assigned_to_user_id == user.id or event.created_by_user_id == user.id:
        return True
    if user.id in (event.assigned_user_ids or []):
        return True
    if event.assignment_id:
        assignment = db.get(Assignment, event.assignment_id)
        if assignment:
            try:
                ensure_assignment_access(assignment, user)
                return True
            except PermissionError:
                return False
    return False


def _can_modify_event(event: CalendarEvent, user: User) -> bool:
    from app.core import rbac

    capabilities = rbac.get_capabilities_for_user(user)
    if capabilities.get("view_all_assignments"):
        return True
    return event.created_by_user_id == user.id


def _normalize_assignees(
    *,
    assigned_to_all: bool,
    assigned_to_user_id: Optional[int],
    assigned_user_ids: Optional[Sequence[int]],
) -> tuple[Optional[int], bool, list[int]]:
    if assigned_to_all:
        return None, True, []
    ids = {int(uid) for uid in (assigned_user_ids or []) if uid}
    if assigned_to_user_id:
        ids.add(int(assigned_to_user_id))
    primary = int(assigned_to_user_id) if assigned_to_user_id else (sorted(ids)[0] if ids else None)
    return primary, False, sorted(ids)


def _to_read_model(event: CalendarEvent) -> CalendarEventRead:
    related_leave_request_id = event.leave_request.id if event.leave_request else None
    payload = CalendarEventRead.model_validate(event, context={"skip_validation": True}).model_dump()
    payload["assigned_user_ids"] = [int(uid) for uid in (payload.get("assigned_user_ids") or []) if uid]
    payload["related_leave_request_id"] = related_leave_request_id
    payload["assignment_code"] = event.assignment.assignment_code if event.assignment else None
    return CalendarEventRead(**payload)


@router.get("", response_model=List[CalendarEventRead])
def list_events(
    start_from: Optional[datetime] = Query(None, description="ISO datetime lower bound"),
    start_to: Optional[datetime] = Query(None, description="ISO datetime upper bound"),
    assigned_to_user_id: Optional[int] = Query(None),
    assignment_id: Optional[int] = Query(None),
    event_type: Optional[CalendarEventType] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[CalendarEventRead]:
    query = db.query(CalendarEvent)
    if start_from:
        query = query.filter(CalendarEvent.start_at >= start_from)
    if start_to:
        query = query.filter(CalendarEvent.start_at <= start_to)
    if assignment_id:
        query = query.filter(CalendarEvent.assignment_id == assignment_id)
    if event_type:
        query = query.filter(CalendarEvent.event_type == event_type)

    events = query.order_by(CalendarEvent.start_at.asc()).all()
    visible = [event for event in events if _can_view_event(db, event, current_user)]

    if assigned_to_user_id:
        def matches_assignee(event: CalendarEvent) -> bool:
            if event.assigned_to_all:
                return True
            if event.assigned_to_user_id == assigned_to_user_id:
                return True
            return assigned_to_user_id in (event.assigned_user_ids or [])

        visible = [event for event in visible if matches_assignee(event)]

    return [_to_read_model(event) for event in visible]


@router.post("", response_model=CalendarEventRead, status_code=status.HTTP_201_CREATED)
def create_event(
    event_in: CalendarEventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CalendarEventRead:
    assignment = _assignment_or_none(db, event_in.assignment_id)
    if assignment:
        try:
            ensure_assignment_access(assignment, current_user)
        except PermissionError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    label = _label_or_none(db, event_in.event_label_id)

    primary_assignee_id, assigned_to_all, assigned_user_ids = _normalize_assignees(
        assigned_to_all=event_in.assigned_to_all,
        assigned_to_user_id=event_in.assigned_to_user_id,
        assigned_user_ids=event_in.assigned_user_ids,
    )

    event = CalendarEvent(
        event_type=event_in.event_type,
        event_label_id=label.id if label else None,
        title=event_in.title,
        description=event_in.description,
        start_at=event_in.start_at,
        end_at=event_in.end_at,
        all_day=event_in.all_day,
        assignment_id=event_in.assignment_id,
        created_by_user_id=current_user.id,
        assigned_to_user_id=primary_assignee_id,
        assigned_to_all=assigned_to_all,
        assigned_user_ids=assigned_user_ids,
        payload_json=event_in.payload_json,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return _to_read_model(event)


@router.patch("/{event_id}", response_model=CalendarEventRead)
def update_event(
    event_id: int,
    event_update: CalendarEventUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CalendarEventRead:
    event = _get_event_or_404(db, event_id)
    if not _can_modify_event(event, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted to modify this event")

    update_data = event_update.model_dump(exclude_unset=True)

    if "assignment_id" in update_data and update_data["assignment_id"]:
        assignment = _assignment_or_none(db, update_data["assignment_id"])
        if assignment:
            try:
                ensure_assignment_access(assignment, current_user)
            except PermissionError as exc:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    if "event_label_id" in update_data:
        label = _label_or_none(db, update_data.get("event_label_id"))
        event.event_label_id = label.id if label else None
        update_data.pop("event_label_id", None)

    assignee_fields = {"assigned_to_all", "assigned_to_user_id", "assigned_user_ids"}
    if assignee_fields.intersection(update_data.keys()):
        primary_assignee_id, assigned_to_all, assigned_user_ids = _normalize_assignees(
            assigned_to_all=update_data.get("assigned_to_all", event.assigned_to_all),
            assigned_to_user_id=update_data.get("assigned_to_user_id", event.assigned_to_user_id),
            assigned_user_ids=update_data.get("assigned_user_ids", event.assigned_user_ids),
        )
        event.assigned_to_user_id = primary_assignee_id
        event.assigned_to_all = assigned_to_all
        event.assigned_user_ids = assigned_user_ids
        for field in assignee_fields:
            update_data.pop(field, None)

    for field, value in update_data.items():
        setattr(event, field, value)

    db.add(event)
    db.commit()
    db.refresh(event)
    return _to_read_model(event)


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    require_destructive_allowed("delete_calendar_event")
    event = _get_event_or_404(db, event_id)
    if event.leave_request and not rbac.user_has_any_role(current_user, {Role.ADMIN, Role.HR, Role.OPS_MANAGER}):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Leave events can only be deleted by approvers")
    if not _can_modify_event(event, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted to delete this event")

    db.delete(event)
    db.commit()
    return None
