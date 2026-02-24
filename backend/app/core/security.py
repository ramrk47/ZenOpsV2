from __future__ import annotations

import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.settings import settings


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def _expiry_delta(expires_delta: Optional[timedelta]) -> timedelta:
    if expires_delta is not None:
        return expires_delta
    minutes = settings.access_token_expire_minutes
    if minutes <= 0:
        minutes = 60
    return timedelta(minutes=minutes)


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    expire = now + _expiry_delta(expires_delta)
    to_encode.setdefault("iat", now)
    to_encode.setdefault("last_activity", now.isoformat())
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.algorithm)


def decode_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.algorithm])


def safe_decode_token(token: str) -> Dict[str, Any]:
    try:
        return decode_token(token)
    except JWTError as exc:  # pragma: no cover - handled by dependency
        raise exc


# ── Backup Codes ────────────────────────────────────────────────────────


_BACKUP_CODE_CHARS = string.ascii_uppercase + string.digits
_BACKUP_CODE_LENGTH = 8
_BACKUP_CODE_COUNT = 10


def generate_backup_codes(count: int = _BACKUP_CODE_COUNT) -> tuple[list[str], list[str]]:
    """Generate backup codes and their bcrypt hashes.

    Returns (plaintext_codes, hashed_codes).
    Plaintext codes are shown to the user once; hashed codes are stored.
    Format: XXXX-XXXX (8 alphanumeric chars, grouped for readability).
    """
    plaintexts: list[str] = []
    hashed: list[str] = []
    for _ in range(count):
        raw = "".join(secrets.choice(_BACKUP_CODE_CHARS) for _ in range(_BACKUP_CODE_LENGTH))
        code = f"{raw[:4]}-{raw[4:]}"
        plaintexts.append(code)
        hashed.append(pwd_context.hash(code))
    return plaintexts, hashed


def verify_and_consume_backup_code(
    code: str, hashed_list: list[str]
) -> tuple[bool, list[str]]:
    """Check a backup code against the hashed list.

    Returns (matched, remaining_hashed_list).
    If matched, the consumed code is removed from the list.
    """
    normalised = code.strip().upper()
    for i, h in enumerate(hashed_list):
        if pwd_context.verify(normalised, h):
            remaining = hashed_list[:i] + hashed_list[i + 1 :]
            return True, remaining
    return False, hashed_list
