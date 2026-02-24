"""Support token utilities for secure external portal access."""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models.support import SupportThread, SupportToken


def generate_support_token(
    db: Session,
    *,
    assignment_id: Optional[int] = None,
    thread_id: Optional[int] = None,
    created_by_user_id: int,
    expires_in_days: int = 7,
) -> tuple[str, SupportToken]:
    """
    Generate a new support token for external portal access.
    
    Args:
        db: Database session
        assignment_id: Optional assignment ID to scope the token
        thread_id: Optional thread ID to scope the token
        created_by_user_id: User ID creating the token
        expires_in_days: Token expiration in days (default: 7)
    
    Returns:
        tuple: (raw_token, SupportToken) - raw token string and database record
    """
    # Generate a secure random token
    raw_token = secrets.token_urlsafe(32)  # 32 bytes = 256 bits
    
    # Hash the token for storage
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    
    # Calculate expiration
    expires_at = datetime.now(timezone.utc) + timedelta(days=expires_in_days)
    
    # Create database record
    support_token = SupportToken(
        token_hash=token_hash,
        assignment_id=assignment_id,
        thread_id=thread_id,
        created_by_user_id=created_by_user_id,
        expires_at=expires_at,
        used_count=0,
    )
    
    db.add(support_token)
    db.flush()
    
    return raw_token, support_token


def verify_support_token(db: Session, raw_token: str) -> Optional[SupportToken]:
    """
    Verify a support token and return the database record if valid.
    
    Args:
        db: Database session
        raw_token: The raw token string
    
    Returns:
        SupportToken if valid and not expired/revoked, None otherwise
    """
    # Hash the raw token
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    
    # Find the token
    support_token = db.query(SupportToken).filter(
        SupportToken.token_hash == token_hash
    ).first()
    
    if not support_token:
        return None
    
    # Check if revoked
    if support_token.revoked_at:
        return None
    
    # Check if expired
    now = datetime.now(timezone.utc)
    if support_token.expires_at < now:
        return None
    
    # Increment use count
    support_token.used_count += 1
    db.add(support_token)
    
    return support_token


def revoke_support_token(db: Session, token_id: int) -> bool:
    """
    Revoke a support token.
    
    Args:
        db: Database session
        token_id: Token ID to revoke
    
    Returns:
        bool: True if revoked, False if not found
    """
    support_token = db.query(SupportToken).filter(SupportToken.id == token_id).first()
    
    if not support_token:
        return False
    
    support_token.revoked_at = datetime.now(timezone.utc)
    db.add(support_token)
    
    return True


def get_token_context(db: Session, token: SupportToken) -> dict:
    """
    Get context information for a support token.
    
    Args:
        db: Database session
        token: SupportToken instance
    
    Returns:
        dict: Token context including assignment, thread, permissions
    """
    context = {
        "token_id": token.id,
        "assignment_id": token.assignment_id,
        "thread_id": token.thread_id,
        "expires_at": token.expires_at.isoformat(),
        "used_count": token.used_count,
    }
    
    # Add assignment details if present
    if token.assignment_id and token.assignment:
        context["assignment"] = {
            "id": token.assignment.id,
            "assignment_code": token.assignment.assignment_code,
            "borrower_name": token.assignment.borrower_name,
            "status": token.assignment.status.value,
        }
    
    # Add thread details if present
    if token.thread_id and token.thread:
        context["thread"] = {
            "id": token.thread.id,
            "subject": token.thread.subject,
            "status": token.thread.status.value,
            "priority": token.thread.priority.value,
        }
    
    return context


def build_support_portal_url(base_url: str, raw_token: str) -> str:
    """
    Build a complete support portal URL with token.
    
    Args:
        base_url: Base URL of the application
        raw_token: Raw token string
    
    Returns:
        str: Complete support portal URL
    """
    return f"{base_url.rstrip('/')}/portal/support?token={raw_token}"
