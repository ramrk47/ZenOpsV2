from __future__ import annotations

import argparse
import logging
import time
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.logging import configure_logging
from app.core.settings import settings
from app.db.session import SessionLocal
from app.models.enums import NotificationDeliveryStatus
from app.models.notification_delivery import NotificationDelivery
from app.services.email import EmailSendError, send_email
from app.services.notification_deliveries import count_emails_sent_today, get_due_email_deliveries
from app.services.notification_templates import build_email_content


logger = logging.getLogger("notification_worker")


def process_deliveries(db: Session, *, limit: int = 50) -> int:
    if settings.email_provider.lower() in {"disabled", "none"}:
        logger.info("Email provider disabled; skipping delivery processing.")
        return 0
    if not settings.email_from:
        logger.warning("EMAIL_FROM not configured; skipping delivery processing.")
        return 0

    deliveries = get_due_email_deliveries(db, limit=limit)
    processed = 0

    for delivery in deliveries:
        processed += 1
        _process_delivery(db, delivery)
        db.commit()
    return processed


def _process_delivery(db: Session, delivery: NotificationDelivery) -> None:
    now = datetime.now(timezone.utc)
    delivery.last_attempt_at = now
    delivery.attempts = (delivery.attempts or 0) + 1

    notification = delivery.notification
    user = delivery.user
    if not notification or not user:
        delivery.status = NotificationDeliveryStatus.FAILED
        delivery.error = "Missing notification or user"
        db.add(delivery)
        return

    if not user.is_active:
        delivery.status = NotificationDeliveryStatus.FAILED
        delivery.error = "User inactive"
        db.add(delivery)
        return

    if not user.email:
        delivery.status = NotificationDeliveryStatus.FAILED
        delivery.error = "User email missing"
        db.add(delivery)
        return

    daily_limit = settings.email_daily_limit
    if daily_limit > 0 and count_emails_sent_today(db, user_id=user.id) >= daily_limit:
        delivery.status = NotificationDeliveryStatus.FAILED
        delivery.error = f"Daily email limit reached ({daily_limit})"
        db.add(delivery)
        return

    content = build_email_content(db, notification=notification, recipient_role=user.role)
    if not content:
        delivery.status = NotificationDeliveryStatus.FAILED
        delivery.error = f"No email template for {notification.type}"
        db.add(delivery)
        return

    try:
        result = send_email(
            to_address=user.email,
            subject=content["subject"],
            html=content["html"],
            text=content.get("text"),
        )
        delivery.status = NotificationDeliveryStatus.SENT
        delivery.sent_at = now
        delivery.provider_message_id = result.message_id
        delivery.error = None
        db.add(delivery)
    except EmailSendError as exc:
        delivery.status = NotificationDeliveryStatus.FAILED
        delivery.error = str(exc)
        db.add(delivery)
    except Exception as exc:  # pragma: no cover - defensive
        delivery.status = NotificationDeliveryStatus.FAILED
        delivery.error = f"Unexpected error: {exc}"
        db.add(delivery)


def main() -> None:
    parser = argparse.ArgumentParser(description="Process pending notification email deliveries.")
    parser.add_argument("--once", action="store_true", help="Run once and exit.")
    parser.add_argument("--interval", type=int, default=30, help="Polling interval in seconds.")
    parser.add_argument("--limit", type=int, default=50, help="Max deliveries per batch.")
    args = parser.parse_args()

    configure_logging(level=settings.log_level)

    while True:
        with SessionLocal() as db:
            processed = process_deliveries(db, limit=args.limit)
        if args.once:
            break
        if processed == 0:
            time.sleep(args.interval)


if __name__ == "__main__":
    main()
