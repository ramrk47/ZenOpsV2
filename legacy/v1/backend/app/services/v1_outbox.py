from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models.v1_outbox_event import V1OutboxEvent


def enqueue_v1_outbox_event(
    db: Session,
    *,
    event_type: str,
    payload: dict,
    event_id: str | None = None,
    available_after_seconds: int = 0,
) -> V1OutboxEvent:
    available_at = datetime.now(timezone.utc) + timedelta(seconds=max(0, int(available_after_seconds)))
    row = V1OutboxEvent(
        event_id=event_id or str(uuid4()),
        event_type=event_type,
        payload_json=payload,
        status="PENDING",
        attempts=0,
        available_at=available_at,
    )
    db.add(row)
    db.flush()
    return row
