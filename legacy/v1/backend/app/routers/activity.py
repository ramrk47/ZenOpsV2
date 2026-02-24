from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.audit import ActivityLog
from app.models.user import User
from app.schemas.audit import ActivityRead

router = APIRouter(prefix="/api/activity", tags=["activity"])


@router.get("", response_model=List[ActivityRead])
def list_activity(
    limit: int = Query(100, ge=1, le=500),
    actor_user_id: Optional[int] = Query(None),
    assignment_id: Optional[int] = Query(None),
    activity_type: Optional[str] = Query(None, max_length=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[ActivityRead]:
    can_view_all = rbac.can_view_all(current_user)

    query = db.query(ActivityLog)

    if assignment_id:
        query = query.filter(ActivityLog.assignment_id == assignment_id)
    if activity_type:
        query = query.filter(ActivityLog.type == activity_type)

    # Non-staff users can only see their own activity trail.
    if not can_view_all:
        query = query.filter(ActivityLog.actor_user_id == current_user.id)
    elif actor_user_id:
        query = query.filter(ActivityLog.actor_user_id == actor_user_id)

    activities = query.order_by(ActivityLog.created_at.desc()).limit(limit).all()
    return [ActivityRead.model_validate(activity) for activity in activities]
