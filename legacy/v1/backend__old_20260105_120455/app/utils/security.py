"""
Security helpers.

This module encapsulates password hashing and JWT token creation/verification.
It also defines the OAuth2PasswordBearer dependency used by FastAPI.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

# OAuth2 bearer token extraction dependency.  The token is expected in
# the `Authorization: Bearer <token>` header on each request.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Read secret and algorithm from environment
SECRET_KEY: str = os.getenv("SECRET_KEY", "changeme")
ALGORITHM: str = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Generate a signed JWT token containing the provided data."""
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def decode_access_token(token: str) -> Dict[str, Any]:
    """Decode and return the payload of a JWT token.

    Raises JWTError on failure.
    """
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])