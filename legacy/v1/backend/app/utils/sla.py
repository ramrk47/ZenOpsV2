from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from typing import Optional, Tuple

DUE_SOON_MINUTES = 4 * 60
ESCALATE_OPS_MANAGER_MINUTES = 72 * 60
ESCALATE_ADMIN_MINUTES = 5 * 24 * 60


def _ensure_tz(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _at_6pm(dt: datetime) -> datetime:
    dt = _ensure_tz(dt)
    return dt.replace(hour=18, minute=0, second=0, microsecond=0)


def compute_due_time(
    created_at: datetime,
    site_visit_date: Optional[datetime],
    report_due_date: Optional[datetime],
) -> Optional[datetime]:
    created_at = _ensure_tz(created_at)
    if report_due_date:
        return _at_6pm(report_due_date)
    if site_visit_date:
        next_day = _ensure_tz(site_visit_date) + timedelta(days=1)
        return _at_6pm(next_day)
    return created_at + timedelta(hours=24)


def compute_due_state(due_time: Optional[datetime], now: Optional[datetime] = None) -> Tuple[str, Optional[int], Optional[int]]:
    if due_time is None:
        return "NA", None, None
    now = _ensure_tz(now or datetime.now(timezone.utc))
    due_time = _ensure_tz(due_time)
    delta = due_time - now
    minutes = int(delta.total_seconds() // 60)
    if minutes < 0:
        return "OVERDUE", None, abs(minutes)
    if minutes <= DUE_SOON_MINUTES:
        return "DUE_SOON", minutes, None
    return "OK", minutes, None


def compute_escalation(minutes_overdue: Optional[int]) -> tuple[Optional[str], Optional[str]]:
    if not minutes_overdue:
        return None, None
    if minutes_overdue >= ESCALATE_ADMIN_MINUTES:
        return "ADMIN", ">=5 days overdue"
    if minutes_overdue >= ESCALATE_OPS_MANAGER_MINUTES:
        return "OPS_MANAGER", ">=72 hours overdue"
    return None, None


def bucket_due_state(due_state: str) -> str:
    if due_state == "OVERDUE":
        return "OVERDUE"
    if due_state == "DUE_SOON":
        return "DUE_SOON"
    if due_state == "OK":
        return "OK"
    return "NA"
