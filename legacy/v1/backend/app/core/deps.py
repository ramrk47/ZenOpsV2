from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

import json
import logging

from fastapi import Depends, HTTPException, Request, Security, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.security import decode_token
from app.core.settings import settings
from app.core.token_blacklist import is_token_revoked
from app.db.session import get_db
from app.models.enums import Role
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
logger = logging.getLogger("security")

PARTNER_ALLOWED_PREFIXES = ("/api/partner", "/api/mobile")
PARTNER_ALLOWED_PATHS = {
    "/api/auth/me",
    "/api/auth/capabilities",
}

# Roles that receive shorter idle timeouts
_ADMIN_ROLES = {Role.ADMIN, Role.OPS_MANAGER, Role.HR, Role.FINANCE}


def _partner_path_allowed(path: str) -> bool:
    if path in PARTNER_ALLOWED_PATHS:
        return True
    return any(path.startswith(prefix) for prefix in PARTNER_ALLOWED_PREFIXES)


def _log_auth_event(event: str, *, request: Request, extra: Optional[dict] = None) -> None:
    payload = {
        "event": event,
        "request_id": request.headers.get("x-request-id"),
        "path": request.url.path,
        "method": request.method,
        "client": request.client.host if request.client else None,
    }
    if extra:
        payload.update(extra)
    logger.info(json.dumps(payload, default=str))


def _check_session_lifetime(payload: dict, request: Request) -> None:
    """Enforce absolute session lifetime (max hours since token issued)."""
    iat = payload.get("iat")
    if iat is None:
        return  # Legacy tokens without iat are allowed through
    try:
        if isinstance(iat, (int, float)):
            issued_at = datetime.fromtimestamp(iat, tz=timezone.utc)
        else:
            return
    except (ValueError, OSError):
        return

    max_lifetime = timedelta(hours=settings.absolute_session_lifetime_hours)
    if datetime.now(timezone.utc) - issued_at > max_lifetime:
        _log_auth_event("session_absolute_expired", request=request)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="session_expired",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _check_idle_timeout(payload: dict, user: User, request: Request) -> None:
    """Enforce idle timeout based on user role."""
    last_activity_str = payload.get("last_activity")
    if not last_activity_str:
        return  # Legacy tokens without last_activity are allowed through
    try:
        last_activity = datetime.fromisoformat(last_activity_str)
    except (ValueError, TypeError):
        return

    is_admin_role = rbac.user_has_any_role(user, _ADMIN_ROLES)
    timeout_minutes = (
        settings.idle_timeout_admin_minutes if is_admin_role
        else settings.idle_timeout_employee_minutes
    )
    if datetime.now(timezone.utc) - last_activity > timedelta(minutes=timeout_minutes):
        _log_auth_event(
            "session_idle_expired",
            request=request,
            extra={"user_id": user.id, "timeout_minutes": timeout_minutes},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="session_expired",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_current_user(
    request: Request,
    token: str = Security(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    # Check if the token has been revoked (logout)
    if is_token_revoked(db, token):
        _log_auth_event("token_revoked", request=request)
        raise credentials_exception

    try:
        payload = decode_token(token)
        raw_user_id: Optional[int | str] = payload.get("sub")
        if raw_user_id is None:
            _log_auth_event("token_missing_sub", request=request)
            raise credentials_exception
        # Reject MFA-pending tokens from accessing protected endpoints
        if payload.get("mfa_pending"):
            _log_auth_event("mfa_pending_token_rejected", request=request)
            raise credentials_exception
        user_id = int(raw_user_id)
    except (JWTError, ValueError, TypeError):
        _log_auth_event("token_invalid", request=request)
        raise credentials_exception

    # Check absolute session lifetime
    _check_session_lifetime(payload, request)

    user = db.get(User, user_id)
    if not user or not user.is_active:
        _log_auth_event("user_inactive_or_missing", request=request, extra={"user_id": user_id})
        raise credentials_exception

    # Check idle timeout (needs user to determine role)
    _check_idle_timeout(payload, user, request)

    if rbac.user_has_role(user, Role.EXTERNAL_PARTNER) and not _partner_path_allowed(request.url.path):
        _log_auth_event(
            "partner_forbidden",
            request=request,
            extra={"user_id": user.id, "path": request.url.path},
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to access this workspace")
    return user
