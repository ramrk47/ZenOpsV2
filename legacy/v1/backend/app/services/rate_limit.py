from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import Request
from sqlalchemy.orm import Session

from app.models.rate_limit_bucket import RateLimitBucket


@dataclass(frozen=True)
class RateLimitDecision:
    key: str
    allowed: bool
    count: int
    limit: int
    retry_after_seconds: int


def get_client_ip(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").strip()
    if forwarded:
        first_hop = forwarded.split(",")[0].strip()
        if first_hop:
            return first_hop
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def consume_rate_limit(
    db: Session,
    *,
    key: str,
    limit: int,
    window_seconds: int,
    now: datetime | None = None,
) -> RateLimitDecision:
    if limit <= 0:
        return RateLimitDecision(key=key, allowed=True, count=0, limit=limit, retry_after_seconds=0)

    current = now or datetime.now(timezone.utc)
    window = max(window_seconds, 1)
    bucket = db.get(RateLimitBucket, key)

    if not bucket:
        bucket = RateLimitBucket(
            key=key,
            window_start=current,
            count=1,
            updated_at=current,
        )
        db.add(bucket)
        db.flush()
        return RateLimitDecision(key=key, allowed=True, count=1, limit=limit, retry_after_seconds=0)

    window_start = bucket.window_start
    if window_start.tzinfo is None:
        window_start = window_start.replace(tzinfo=timezone.utc)
    window_expired = current >= (window_start + timedelta(seconds=window))

    if window_expired:
        bucket.window_start = current
        bucket.count = 1
        bucket.updated_at = current
        db.add(bucket)
        db.flush()
        return RateLimitDecision(key=key, allowed=True, count=1, limit=limit, retry_after_seconds=0)

    bucket.count += 1
    bucket.updated_at = current
    db.add(bucket)
    db.flush()

    retry_after = max(1, int((window_start + timedelta(seconds=window) - current).total_seconds()))
    allowed = bucket.count <= limit
    return RateLimitDecision(
        key=key,
        allowed=allowed,
        count=bucket.count,
        limit=limit,
        retry_after_seconds=(0 if allowed else retry_after),
    )
