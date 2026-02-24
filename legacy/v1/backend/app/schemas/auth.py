from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import Field

from app.schemas.base import ORMModel
from app.schemas.user import UserRead


class Token(ORMModel):
    access_token: str
    token_type: str = "bearer"


class LoginResponse(Token):
    user: UserRead
    capabilities: Dict[str, bool]
    mfa_required: bool = False
    mfa_token: Optional[str] = None


class MFAVerifyRequest(ORMModel):
    mfa_token: str
    totp_code: str = Field(..., min_length=6, max_length=6)


class BackupCodeLoginRequest(ORMModel):
    """Login using a one-time backup code instead of TOTP."""
    mfa_token: str
    backup_code: str = Field(..., min_length=4, max_length=12)


class TOTPSetupResponse(ORMModel):
    secret: str
    provisioning_uri: str
    issuer: str = "Zen Ops"
    backup_codes: Optional[List[str]] = None


class TOTPVerifySetupRequest(ORMModel):
    totp_code: str = Field(..., min_length=6, max_length=6)


class BackupCodesResponse(ORMModel):
    """Response when backup codes are generated/regenerated."""
    backup_codes: List[str]
    count: int


class StepUpVerifyRequest(ORMModel):
    """TOTP code submitted for step-up re-authentication."""
    totp_code: str = Field(..., min_length=6, max_length=6)


class StepUpTokenResponse(ORMModel):
    """Short-lived step-up JWT returned on successful re-auth."""
    step_up_token: str
    expires_in_seconds: int = 300  # 5 minutes


class CapabilityResponse(ORMModel):
    role: str
    capabilities: Dict[str, bool]
    meta: Dict[str, Any] | None = None
