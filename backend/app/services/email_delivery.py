"""Email delivery service with idempotency and logging for support system."""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models.support import EmailDeliveryLog
from app.services.email import EmailSendError, send_email


logger = logging.getLogger(__name__)


def create_email_delivery(
    db: Session,
    *,
    event_type: str,
    to_email: str,
    subject: str,
    html: str,
    text: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    payload: Optional[dict] = None,
) -> EmailDeliveryLog:
    """
    Create an email delivery log entry with idempotency.
    
    Args:
        db: Database session
        event_type: Type of event triggering the email (e.g. "SUPPORT_THREAD_CREATED")
        to_email: Recipient email address
        subject: Email subject
        html: HTML email body
        text: Plain text email body (optional)
        idempotency_key: Unique key to prevent duplicate sends (auto-generated if not provided)
        payload: Additional metadata (stored as JSON)
    
    Returns:
        EmailDeliveryLog: The created or existing delivery log entry
    
    Raises:
        Exception: If creation fails
    """
    # Generate idempotency key if not provided
    if not idempotency_key:
        key_data = f"{event_type}:{to_email}:{subject}:{datetime.now(timezone.utc).isoformat()}"
        idempotency_key = hashlib.sha256(key_data.encode()).hexdigest()[:64]
    
    # Check for existing delivery with same idempotency key
    existing = db.query(EmailDeliveryLog).filter(
        EmailDeliveryLog.idempotency_key == idempotency_key
    ).first()
    
    if existing:
        logger.info(f"Email delivery already exists (idempotency): {idempotency_key}")
        return existing
    
    # Create new delivery log
    delivery = EmailDeliveryLog(
        event_type=event_type,
        idempotency_key=idempotency_key,
        to_email=to_email,
        subject=subject,
        status="QUEUED",
        provider="resend",  # Default, will be updated when sent
        attempts=0,
        payload_json=payload or {},
    )
    
    # Store email content in payload for retry
    delivery.payload_json.update({
        "html": html,
        "text": text,
    })
    
    db.add(delivery)
    db.flush()
    
    logger.info(
        f"Created email delivery: {delivery.id} "
        f"(event={event_type}, to={to_email}, idem={idempotency_key[:12]}...)"
    )
    
    return delivery


def send_email_delivery(db: Session, delivery: EmailDeliveryLog) -> bool:
    """
    Attempt to send an email delivery.
    
    Args:
        db: Database session
        delivery: EmailDeliveryLog to send
    
    Returns:
        bool: True if sent successfully, False otherwise
    """
    now = datetime.now(timezone.utc)
    delivery.attempts += 1
    delivery.updated_at = now
    
    # Extract email content from payload
    html = delivery.payload_json.get("html", "")
    text = delivery.payload_json.get("text")
    
    if not html:
        delivery.status = "FAILED"
        delivery.last_error = "No HTML content in payload"
        db.add(delivery)
        logger.error(f"Email delivery {delivery.id} has no HTML content")
        return False
    
    try:
        result = send_email(
            to_address=delivery.to_email,
            subject=delivery.subject,
            html=html,
            text=text,
        )
        
        delivery.status = "SENT"
        delivery.provider = result.provider
        delivery.provider_message_id = result.message_id
        delivery.last_error = None
        db.add(delivery)
        
        logger.info(
            f"Email delivery {delivery.id} sent successfully "
            f"(provider={result.provider}, message_id={result.message_id})"
        )
        return True
        
    except EmailSendError as exc:
        delivery.status = "FAILED"
        delivery.last_error = str(exc)
        db.add(delivery)
        logger.error(f"Email delivery {delivery.id} failed: {exc}")
        return False
        
    except Exception as exc:  # pragma: no cover
        delivery.status = "FAILED"
        delivery.last_error = f"Unexpected error: {exc}"
        db.add(delivery)
        logger.exception(f"Email delivery {delivery.id} unexpected error: {exc}")
        return False


def get_queued_email_deliveries(db: Session, limit: int = 50) -> list[EmailDeliveryLog]:
    """Get queued email deliveries that need to be sent."""
    return (
        db.query(EmailDeliveryLog)
        .filter(EmailDeliveryLog.status == "QUEUED")
        .filter(EmailDeliveryLog.attempts < 5)  # Max 5 attempts
        .order_by(EmailDeliveryLog.created_at.asc())
        .limit(limit)
        .all()
    )


def get_failed_email_deliveries_for_retry(db: Session, limit: int = 20) -> list[EmailDeliveryLog]:
    """Get failed email deliveries that should be retried."""
    return (
        db.query(EmailDeliveryLog)
        .filter(EmailDeliveryLog.status == "FAILED")
        .filter(EmailDeliveryLog.attempts < 5)  # Max 5 attempts
        .filter(EmailDeliveryLog.attempts > 0)  # At least one previous attempt
        .order_by(EmailDeliveryLog.updated_at.asc())
        .limit(limit)
        .all()
    )


def process_email_deliveries(db: Session, limit: int = 50) -> int:
    """
    Process queued and failed email deliveries.
    
    Args:
        db: Database session
        limit: Maximum number of deliveries to process
    
    Returns:
        int: Number of deliveries processed
    """
    # Get queued deliveries
    queued = get_queued_email_deliveries(db, limit=limit)
    
    # Also retry some failed deliveries (with exponential backoff)
    failed = get_failed_email_deliveries_for_retry(db, limit=max(10, limit // 5))
    
    deliveries = queued + failed
    processed = 0
    
    for delivery in deliveries:
        try:
            send_email_delivery(db, delivery)
            db.commit()
            processed += 1
        except Exception as exc:  # pragma: no cover
            logger.exception(f"Failed to process email delivery {delivery.id}: {exc}")
            db.rollback()
    
    if processed > 0:
        logger.info(f"Processed {processed} email deliveries")
    
    return processed
