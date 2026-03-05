"""Step-up MFA dependency for sensitive actions.

Endpoints that require a fresh TOTP challenge within an active session
should add ``Depends(require_step_up)`` to their signature.  The frontend
sends a short-lived step-up JWT in the ``X-Step-Up-Token`` header after
the user re-authenticates with their TOTP code.
"""

from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Any, Dict

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError

from app.core import rbac
from app.core.deps import get_current_user
from app.core.security import create_access_token, decode_token
from app.core.settings import settings
from app.models.enums import Role
from app.models.user import User

STEP_UP_EXPIRY_MINUTES = 5


def create_step_up_token(user_id: int) -> str:
    """Create a short-lived JWT asserting step-up authentication."""
    return create_access_token(
        {"sub": str(user_id), "step_up": True},
        expires_delta=timedelta(minutes=STEP_UP_EXPIRY_MINUTES),
    )


def _raise_step_up_required() -> None:
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="step_up_required",
    )


def _decode_step_up_token(token: str | None) -> Dict[str, Any]:
    if not token:
        _raise_step_up_required()
    try:
        payload = decode_token(token)
    except JWTError:
        _raise_step_up_required()
    if not payload.get("step_up"):
        _raise_step_up_required()
    return payload


def require_step_up(request: Request) -> Dict[str, Any]:
    """FastAPI dependency that validates the ``X-Step-Up-Token`` header.

    Raises 403 with ``detail="step_up_required"`` when the header is
    missing or the token is invalid/expired so the frontend can prompt
    for re-authentication.
    """
    return _decode_step_up_token(request.headers.get("X-Step-Up-Token"))


def require_step_up_or_admin_master_key(
    request: Request,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Allow admin master-key auth for selected sensitive actions.

    This is intentionally scoped to endpoints that explicitly opt-in.
    All other step-up protected endpoints should continue using
    ``require_step_up``.
    """
    provided_master_key = (request.headers.get("X-Admin-Master-Key") or "").strip()
    configured_master_key = (settings.admin_master_key or "").strip()
    if provided_master_key and configured_master_key:
        if rbac.user_has_any_role(current_user, {Role.ADMIN}) and secrets.compare_digest(
            provided_master_key,
            configured_master_key,
        ):
            return {
                "sub": str(current_user.id),
                "step_up": True,
                "auth": "admin_master_key",
            }
    return _decode_step_up_token(request.headers.get("X-Step-Up-Token"))
