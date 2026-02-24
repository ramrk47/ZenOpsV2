"""Step-up MFA dependency for sensitive actions.

Endpoints that require a fresh TOTP challenge within an active session
should add ``Depends(require_step_up)`` to their signature.  The frontend
sends a short-lived step-up JWT in the ``X-Step-Up-Token`` header after
the user re-authenticates with their TOTP code.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any, Dict

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError

from app.core.security import create_access_token, decode_token

STEP_UP_EXPIRY_MINUTES = 5


def create_step_up_token(user_id: int) -> str:
    """Create a short-lived JWT asserting step-up authentication."""
    return create_access_token(
        {"sub": str(user_id), "step_up": True},
        expires_delta=timedelta(minutes=STEP_UP_EXPIRY_MINUTES),
    )


def require_step_up(request: Request) -> Dict[str, Any]:
    """FastAPI dependency that validates the ``X-Step-Up-Token`` header.

    Raises 403 with ``detail="step_up_required"`` when the header is
    missing or the token is invalid/expired so the frontend can prompt
    for re-authentication.
    """
    token = request.headers.get("X-Step-Up-Token")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="step_up_required",
        )

    try:
        payload = decode_token(token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="step_up_required",
        )

    if not payload.get("step_up"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="step_up_required",
        )

    return payload
