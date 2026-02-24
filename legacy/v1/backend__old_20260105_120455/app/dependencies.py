"""
Common FastAPI dependencies.

These functions are used to inject a database session and the current user
into request handlers.  They also enforce role‑based capabilities when
required.
"""

from __future__ import annotations

from typing import Generator, Annotated

from fastapi import Depends, HTTPException, status
from jose import JWTError
from sqlalchemy.orm import Session

from .db import SessionLocal
from .models.user import User
from .utils import security, rbac


def get_db() -> Generator[Session, None, None]:
    """Provide a transactional database session for each request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    db: Annotated[Session, Depends(get_db)],
    token: Annotated[str | None, Depends(security.oauth2_scheme)] = None,
) -> User:
    """Return the user corresponding to the provided JWT access token.

    Raises 401/403 errors on invalid or expired tokens.
    """
    if token is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing credentials")
    try:
        payload = security.decode_access_token(token)
        user_id: int = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def get_current_active_user(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Ensure the current user is active."""
    if not current_user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user")
    return current_user


def require_capability(capability: str):
    """Return a dependency function that ensures the user has a capability."""

    def dependency(
        current_user: Annotated[User, Depends(get_current_active_user)],
    ) -> User:
        if not rbac.user_has_capability(current_user, capability):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return current_user

    return dependency