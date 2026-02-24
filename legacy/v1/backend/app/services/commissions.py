from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional, Sequence

from sqlalchemy.orm import Session

from app.models.partner import CommissionRequest, CommissionRequestFloorArea


def _decimal(value: Decimal | float | int | str) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def sync_commission_floors(
    db: Session,
    commission: CommissionRequest,
    floors_payload: Optional[Sequence[dict]],
) -> Decimal | None:
    if floors_payload is None:
        return None

    for floor in list(commission.floors or []):
        db.delete(floor)
    db.flush()

    total = Decimal("0.00")
    for idx, floor in enumerate(floors_payload):
        payload = floor.model_dump() if hasattr(floor, "model_dump") else dict(floor)
        area = _decimal(payload["area"])
        total += area
        db.add(
            CommissionRequestFloorArea(
                commission_request_id=commission.id,
                floor_name=str(payload["floor_name"]).strip(),
                area=area,
                order_index=int(payload.get("order_index", idx)),
            )
        )
    db.flush()
    return total.quantize(Decimal("0.01"))


def generate_commission_code(db: Session) -> str:
    today = datetime.now(timezone.utc)
    date_part = today.strftime("%y%m")
    prefix = f"CR-{date_part}-"
    month_count = db.query(CommissionRequest).filter(CommissionRequest.request_code.like(f"{prefix}%")).count()
    seq = month_count + 1
    return f"{prefix}{seq:04d}"
