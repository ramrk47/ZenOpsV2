from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import secrets

from sqlalchemy.orm import Session

from app.models.enums import Role
from app.models.user_invite import UserInvite


INVITE_EXPIRY_HOURS = 48


def hash_invite_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_invite(
    db: Session,
    *,
    email: str,
    role: Role,
    created_by_user_id: int | None,
    metadata_json: dict | None = None,
) -> tuple[UserInvite, str]:
    raw_token = secrets.token_urlsafe(32)
    invite = UserInvite(
        email=email.lower().strip(),
        role=role.value,
        token_hash=hash_invite_token(raw_token),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=INVITE_EXPIRY_HOURS),
        created_by_user_id=created_by_user_id,
        metadata_json=metadata_json or {},
    )
    db.add(invite)
    db.flush()
    return invite, raw_token
