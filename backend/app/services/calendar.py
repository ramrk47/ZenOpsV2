from __future__ import annotations

from datetime import datetime, time, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models.assignment import Assignment
from app.models.calendar import CalendarEvent
from app.models.enums import CalendarEventType
from app.models.leave import LeaveRequest
from app.models.task import AssignmentTask


def _task_event_type(task: AssignmentTask) -> CalendarEventType:
    if task.template_type == "invoice_overdue":
        return CalendarEventType.PAYMENT_FOLLOWUP
    return CalendarEventType.TASK_DUE


def _task_payload(task: AssignmentTask) -> dict:
    payload = {"task_id": task.id}
    if task.assignment_id:
        payload["assignment_id"] = task.assignment_id
    if task.invoice_id:
        payload["invoice_id"] = task.invoice_id
    return payload


def upsert_task_due_event(db: Session, *, task: AssignmentTask, assignment: Assignment, actor_user_id: int) -> Optional[CalendarEvent]:
    if not task.due_at:
        if task.calendar_event_id:
            existing = db.get(CalendarEvent, task.calendar_event_id)
            if existing:
                db.delete(existing)
            task.calendar_event_id = None
            db.flush()
        return None

    event_type = _task_event_type(task)
    payload = _task_payload(task)

    if task.calendar_event_id:
        event = db.get(CalendarEvent, task.calendar_event_id)
        if event:
            event.event_type = event_type
            event.title = f"Task Due: {task.title}"
            event.start_at = task.due_at
            event.end_at = task.due_at
            event.assignment_id = assignment.id
            event.assigned_to_user_id = task.assigned_to_user_id
            event.assigned_to_all = False
            event.assigned_user_ids = [task.assigned_to_user_id] if task.assigned_to_user_id else []
            event.payload_json = payload
            db.add(event)
            db.flush()
            return event

    event = CalendarEvent(
        event_type=event_type,
        title=f"Task Due: {task.title}",
        start_at=task.due_at,
        end_at=task.due_at,
        all_day=False,
        assignment_id=assignment.id,
        created_by_user_id=actor_user_id,
        assigned_to_user_id=task.assigned_to_user_id,
        assigned_to_all=False,
        assigned_user_ids=[task.assigned_to_user_id] if task.assigned_to_user_id else [],
        payload_json=payload,
    )
    db.add(event)
    db.flush()
    task.calendar_event_id = event.id
    db.add(task)
    db.flush()
    return event


def _upsert_assignment_event(
    db: Session,
    *,
    assignment: Assignment,
    actor_user_id: int,
    event_type: CalendarEventType,
    when: Optional[datetime],
    title_prefix: str,
) -> Optional[CalendarEvent]:
    existing = (
        db.query(CalendarEvent)
        .filter(CalendarEvent.assignment_id == assignment.id, CalendarEvent.event_type == event_type)
        .order_by(CalendarEvent.created_at.desc())
        .first()
    )

    if not when:
        if existing:
            db.delete(existing)
            db.flush()
        return None

    assignee_ids = assignment.assignee_user_ids
    primary = assignment.assigned_to_user_id or (assignee_ids[0] if assignee_ids else None)
    payload = {
        "assignment_id": assignment.id,
        "assignment_code": assignment.assignment_code,
        "event_type": str(event_type),
    }

    if existing:
        existing.title = f"{title_prefix} — {assignment.assignment_code}"
        existing.start_at = when
        existing.end_at = when
        existing.assignment_id = assignment.id
        existing.assigned_to_user_id = primary
        existing.assigned_to_all = False
        existing.assigned_user_ids = assignee_ids
        existing.payload_json = payload
        db.add(existing)
        db.flush()
        return existing

    event = CalendarEvent(
        event_type=event_type,
        title=f"{title_prefix} — {assignment.assignment_code}",
        start_at=when,
        end_at=when,
        all_day=False,
        assignment_id=assignment.id,
        created_by_user_id=actor_user_id,
        assigned_to_user_id=primary,
        assigned_to_all=False,
        assigned_user_ids=assignee_ids,
        payload_json=payload,
    )
    db.add(event)
    db.flush()
    return event


def upsert_assignment_events(db: Session, *, assignment: Assignment, actor_user_id: int) -> None:
    _upsert_assignment_event(
        db,
        assignment=assignment,
        actor_user_id=actor_user_id,
        event_type=CalendarEventType.SITE_VISIT,
        when=assignment.site_visit_date,
        title_prefix="Site Visit",
    )
    _upsert_assignment_event(
        db,
        assignment=assignment,
        actor_user_id=actor_user_id,
        event_type=CalendarEventType.REPORT_DUE,
        when=assignment.report_due_date,
        title_prefix="Report Due",
    )


def _leave_bounds(leave: LeaveRequest) -> tuple[datetime, datetime]:
    start_at = datetime.combine(leave.start_date, time(hour=0, minute=0, second=0, tzinfo=timezone.utc))
    end_date = leave.end_date or leave.start_date
    end_at = datetime.combine(end_date, time(hour=23, minute=59, second=59, tzinfo=timezone.utc))
    return start_at, end_at


def upsert_leave_event(db: Session, *, leave: LeaveRequest, actor_user_id: int) -> CalendarEvent:
    start_at, end_at = _leave_bounds(leave)
    title = f"Leave: {leave.leave_type}"
    payload = {"leave_request_id": leave.id, "leave_type": str(leave.leave_type)}

    if leave.calendar_event_id:
        existing = db.get(CalendarEvent, leave.calendar_event_id)
        if existing:
            existing.event_type = CalendarEventType.LEAVE
            existing.title = title
            existing.start_at = start_at
            existing.end_at = end_at
            existing.all_day = True
            existing.assignment_id = None
            existing.created_by_user_id = actor_user_id
            existing.assigned_to_user_id = leave.requester_user_id
            existing.assigned_to_all = False
            existing.assigned_user_ids = [leave.requester_user_id]
            existing.payload_json = payload
            db.add(existing)
            db.flush()
            return existing

    event = CalendarEvent(
        event_type=CalendarEventType.LEAVE,
        title=title,
        description=leave.reason,
        start_at=start_at,
        end_at=end_at,
        all_day=True,
        assignment_id=None,
        created_by_user_id=actor_user_id,
        assigned_to_user_id=leave.requester_user_id,
        assigned_to_all=False,
        assigned_user_ids=[leave.requester_user_id],
        payload_json=payload,
    )
    db.add(event)
    db.flush()
    leave.calendar_event_id = event.id
    db.add(leave)
    db.flush()
    return event
