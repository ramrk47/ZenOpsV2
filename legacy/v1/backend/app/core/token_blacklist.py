"""Database-backed JWT token blacklist for proper logout support.

Uses a SHA-256 hash of the token to avoid storing raw JWTs in the DB.
Works across multiple gunicorn workers since all share the same database.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from sqlalchemy.orm import Session


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def revoke_token(db: Session, token: str, expires_at: datetime) -> None:
    """Add a token to the revocation list."""
    from app.models.revoked_token import RevokedToken

    token_hash = _hash_token(token)
    existing = db.query(RevokedToken).filter(RevokedToken.token_hash == token_hash).first()
    if existing:
        return

    entry = RevokedToken(
        token_hash=token_hash,
        expires_at=expires_at,
        revoked_at=datetime.now(timezone.utc),
    )
    db.add(entry)
    db.flush()


def is_token_revoked(db: Session, token: str) -> bool:
    """Return True if the token has been revoked."""
    from app.models.revoked_token import RevokedToken

    token_hash = _hash_token(token)
    entry = db.query(RevokedToken).filter(RevokedToken.token_hash == token_hash).first()
    if entry is None:
        return False

    # If the token's expiry has passed, clean it up and return False
    now = datetime.now(timezone.utc)
    if entry.expires_at <= now:
        db.delete(entry)
        db.flush()
        return False

    return True


def cleanup_expired(db: Session) -> int:
    """Remove expired revocation entries. Returns number of rows deleted."""
    from app.models.revoked_token import RevokedToken

    now = datetime.now(timezone.utc)
    count = db.query(RevokedToken).filter(RevokedToken.expires_at <= now).delete()
    db.flush()
    return count
