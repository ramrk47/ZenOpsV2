from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.models.audit import ActivityLog


def log_activity(
    db: Session,
    *,
    actor_user_id: Optional[int],
    activity_type: str,
    assignment_id: Optional[int] = None,
    message: Optional[str] = None,
    payload: Optional[dict] = None,
) -> ActivityLog:
    activity = ActivityLog(
        actor_user_id=actor_user_id,
        type=activity_type,
        assignment_id=assignment_id,
        message=message,
        payload_json=payload,
    )
    db.add(activity)
    db.flush()
    return activity
