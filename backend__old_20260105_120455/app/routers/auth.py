"""
Authentication routes.

Provides login and introspection endpoints.  Login returns a JWT access
token that must be included in subsequent requests.  The `/me` endpoint
returns the current user's profile, and `/capabilities` returns the
capability set derived from the user's role.
"""

from __future__ import annotations

from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from ..dependencies import get_db, get_current_active_user
from ..models.user import User
from ..utils import security, rbac
from ..schemas.auth import Token
from ..schemas.user import UserRead

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Authenticate a user and return a JWT access token."""
    user: User | None = db.query(User).filter(User.email == form_data.username).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
    if not security.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user")
    access_token_expires = timedelta(minutes=security.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = security.create_access_token({"sub": user.id}, expires_delta=access_token_expires)
    return Token(access_token=access_token, token_type="bearer")


@router.get("/me", response_model=UserRead)
def read_users_me(current_user: User = Depends(get_current_active_user)):
    """Return the current user's details."""
    return current_user


@router.get("/capabilities")
def get_capabilities(current_user: User = Depends(get_current_active_user)) -> dict[str, list[str]]:
    """Return the capability set for the current user."""
    capabilities = sorted(rbac.get_capabilities_for_user(current_user))
    return {"capabilities": capabilities}