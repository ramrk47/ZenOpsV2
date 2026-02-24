from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import logging

import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.deps import get_current_user, oauth2_scheme
from app.core.step_up import create_step_up_token, require_step_up
from app.core.security import (
    create_access_token,
    decode_token,
    generate_backup_codes,
    get_password_hash,
    verify_and_consume_backup_code,
    verify_password,
)
from app.core.token_blacklist import revoke_token
from app.db.session import get_db
from app.models.audit import ActivityLog
from app.models.enums import Role
from app.models.partner import ExternalPartner
from app.models.user import User
from app.schemas.auth import (
    BackupCodeLoginRequest,
    BackupCodesResponse,
    CapabilityResponse,
    LoginResponse,
    MFAVerifyRequest,
    StepUpTokenResponse,
    StepUpVerifyRequest,
    TOTPSetupResponse,
    TOTPVerifySetupRequest,
)
from app.schemas.user import UserCreate, UserRead, UserSelfUpdate
from app.services.activity import log_activity
from app.services.attendance import record_heartbeat, close_session
from app.core.settings import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger("security")

MFA_TOKEN_EXPIRE_MINUTES = 5  # short-lived token for MFA verification step


def _log_auth_event(event: str, *, request: Request, extra: dict | None = None) -> None:
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


def _login_rate_limited(db: Session, *, email: str, client_ip: str) -> bool:
    window_start = datetime.now(timezone.utc) - timedelta(minutes=settings.login_window_minutes)
    recent = (
        db.query(ActivityLog)
        .filter(
            ActivityLog.type == "USER_LOGIN_FAILED",
            ActivityLog.created_at >= window_start,
        )
        .order_by(ActivityLog.created_at.desc())
        .limit(200)
        .all()
    )
    hits = 0
    for log in recent:
        payload = log.payload_json or {}
        if payload.get("email") == email or payload.get("ip") == client_ip:
            hits += 1
    return hits >= settings.login_max_attempts


def _build_full_login_response(user: User, db: Session) -> LoginResponse:
    """Build a full LoginResponse with access token and capabilities."""
    capabilities = rbac.get_capabilities_for_user(user)
    roles_payload = [role.value for role in rbac.roles_for_user(user)]
    token = create_access_token({"sub": str(user.id), "role": user.role.value, "roles": roles_payload})
    return LoginResponse(
        access_token=token,
        user=UserRead.model_validate(user),
        capabilities=capabilities,
        mfa_required=False,
    )


@router.post("/login", response_model=LoginResponse)
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
) -> LoginResponse:
    email = form_data.username.lower()
    client_ip = request.client.host if request.client else "unknown"
    user = db.query(User).filter(User.email == email).first()
    password_valid = bool(user and verify_password(form_data.password, user.hashed_password))
    rate_limited = _login_rate_limited(db, email=email, client_ip=client_ip)

    if not password_valid:
        if rate_limited:
            log_activity(
                db,
                actor_user_id=None,
                activity_type="USER_LOGIN_RATE_LIMIT",
                message="Login rate limited",
                payload={"email": email, "ip": client_ip},
            )
            db.commit()
            _log_auth_event("login_rate_limited", request=request, extra={"email": email})
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many login attempts")
        log_activity(
            db,
            actor_user_id=None,
            activity_type="USER_LOGIN_FAILED",
            message="Login failed",
            payload={"email": email, "ip": client_ip},
        )
        db.commit()
        _log_auth_event("login_failed", request=request, extra={"email": email})
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Incorrect email or password")
    if rate_limited:
        _log_auth_event("login_rate_limited_bypass_valid_credentials", request=request, extra={"email": email})
    if not user.is_active:
        _log_auth_event("login_inactive", request=request, extra={"user_id": user.id})
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is inactive")

    now = datetime.now(timezone.utc)
    user.last_login_at = now
    db.add(user)

    # If TOTP MFA is enabled, return a short-lived MFA token instead of a full session
    if user.totp_enabled and user.totp_secret:
        mfa_token = create_access_token(
            {"sub": str(user.id), "mfa_pending": True},
            expires_delta=timedelta(minutes=MFA_TOKEN_EXPIRE_MINUTES),
        )
        log_activity(
            db,
            actor_user_id=user.id,
            activity_type="USER_MFA_CHALLENGE",
            message="MFA challenge issued",
            payload={"at": now.isoformat()},
        )
        db.commit()
        db.refresh(user)
        _log_auth_event("mfa_challenge", request=request, extra={"user_id": user.id})
        return LoginResponse(
            access_token="",
            user=UserRead.model_validate(user),
            capabilities={},
            mfa_required=True,
            mfa_token=mfa_token,
        )

    # No MFA — issue full token
    log_activity(
        db,
        actor_user_id=user.id,
        activity_type="USER_LOGIN",
        message="User logged in",
        payload={"at": now.isoformat()},
    )

    # Start attendance work session
    record_heartbeat(db, user_id=user.id)

    db.commit()
    db.refresh(user)

    return _build_full_login_response(user, db)


@router.post("/mfa/verify", response_model=LoginResponse)
def verify_mfa(
    request: Request,
    body: MFAVerifyRequest,
    db: Session = Depends(get_db),
) -> LoginResponse:
    """Verify TOTP code after initial login to complete authentication."""
    try:
        payload = decode_token(body.mfa_token)
    except Exception:
        _log_auth_event("mfa_token_invalid", request=request)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired MFA token")

    if not payload.get("mfa_pending"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Token is not an MFA challenge token")

    user_id = int(payload["sub"])
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    if not user.totp_secret or not user.totp_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="MFA is not enabled for this user")

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(body.totp_code, valid_window=1):
        log_activity(
            db,
            actor_user_id=user.id,
            activity_type="USER_MFA_FAILED",
            message="MFA verification failed",
        )
        db.commit()
        _log_auth_event("mfa_failed", request=request, extra={"user_id": user.id})
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid TOTP code")

    now = datetime.now(timezone.utc)
    log_activity(
        db,
        actor_user_id=user.id,
        activity_type="USER_LOGIN",
        message="User logged in (MFA verified)",
        payload={"at": now.isoformat(), "mfa": True},
    )
    record_heartbeat(db, user_id=user.id)
    db.commit()
    db.refresh(user)

    _log_auth_event("mfa_success", request=request, extra={"user_id": user.id})
    return _build_full_login_response(user, db)


# ── Logout ────────────────────────────────────────────────────────────────


@router.post("/logout", response_model=dict)
def logout(
    request: Request,
    token: str = Depends(oauth2_scheme),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Revoke the current access token, ending the session."""
    try:
        from datetime import datetime, timezone as tz
        payload = decode_token(token)
        exp_ts = payload.get("exp", 0)
        exp_dt = datetime.fromtimestamp(float(exp_ts), tz=tz.utc)
        revoke_token(db, token, exp_dt)
    except Exception:
        pass  # Token is about to be invalid anyway

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="USER_LOGOUT",
        message="User logged out",
    )
    # Close the active work session
    close_session(db, user_id=current_user.id)
    db.commit()

    _log_auth_event("logout", request=request, extra={"user_id": current_user.id})
    return {"status": "ok", "message": "Logged out successfully"}


# ── TOTP Setup / Management ──────────────────────────────────────────────


@router.post("/totp/setup", response_model=TOTPSetupResponse)
def totp_setup(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TOTPSetupResponse:
    """Generate a new TOTP secret and provisioning URI for the current user.

    The secret is stored but not activated until verified via /totp/verify-setup.
    """
    if current_user.totp_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TOTP is already enabled. Disable it first to re-setup.")

    secret = pyotp.random_base32()
    current_user.totp_secret = secret
    current_user.totp_enabled = False  # stays disabled until verified
    db.add(current_user)
    db.commit()

    totp = pyotp.TOTP(secret)
    provisioning_uri = totp.provisioning_uri(
        name=current_user.email,
        issuer_name="Zen Ops",
    )

    return TOTPSetupResponse(
        secret=secret,
        provisioning_uri=provisioning_uri,
    )


@router.post("/totp/verify-setup")
def totp_verify_setup(
    body: TOTPVerifySetupRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Verify the TOTP code during setup to activate MFA for the user.

    On success, also generates one-time backup codes for account recovery.
    These codes are shown once and must be saved by the user.
    """
    if current_user.totp_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TOTP is already enabled")

    if not current_user.totp_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No TOTP secret found. Call /totp/setup first.")

    totp = pyotp.TOTP(current_user.totp_secret)
    if not totp.verify(body.totp_code, valid_window=1):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid TOTP code. Please try again.")

    # Generate backup codes
    plaintext_codes, hashed_codes = generate_backup_codes()

    current_user.totp_enabled = True
    current_user.backup_codes_hash = hashed_codes
    db.add(current_user)

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="USER_TOTP_ENABLED",
        message="User enabled TOTP MFA with backup codes",
    )

    db.commit()
    return {
        "status": "ok",
        "message": "TOTP MFA is now enabled",
        "backup_codes": plaintext_codes,
    }


@router.post("/totp/disable", response_model=dict)
def totp_disable(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _step_up: dict = Depends(require_step_up),
) -> dict:
    """Disable TOTP MFA for the current user.  Requires step-up authentication."""
    if not current_user.totp_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TOTP is not enabled")

    current_user.totp_enabled = False
    current_user.totp_secret = None
    current_user.backup_codes_hash = None
    db.add(current_user)

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="USER_TOTP_DISABLED",
        message="User disabled TOTP MFA",
    )

    db.commit()
    return {"status": "ok", "message": "TOTP MFA has been disabled"}


# ── Backup Code Login ────────────────────────────────────────────────────


@router.post("/mfa/verify-backup", response_model=LoginResponse)
def verify_mfa_backup(
    request: Request,
    body: BackupCodeLoginRequest,
    db: Session = Depends(get_db),
) -> LoginResponse:
    """Verify a one-time backup code after initial login to complete authentication.

    The backup code is consumed and cannot be reused.
    """
    try:
        payload = decode_token(body.mfa_token)
    except Exception:
        _log_auth_event("mfa_backup_token_invalid", request=request)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired MFA token")

    if not payload.get("mfa_pending"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Token is not an MFA challenge token")

    user_id = int(payload["sub"])
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    if not user.backup_codes_hash:
        _log_auth_event("mfa_backup_no_codes", request=request, extra={"user_id": user.id})
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No backup codes available")

    matched, remaining = verify_and_consume_backup_code(body.backup_code, user.backup_codes_hash)
    if not matched:
        log_activity(
            db,
            actor_user_id=user.id,
            activity_type="USER_MFA_BACKUP_FAILED",
            message="Backup code verification failed",
        )
        db.commit()
        _log_auth_event("mfa_backup_failed", request=request, extra={"user_id": user.id})
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid backup code")

    # Consume the code
    user.backup_codes_hash = remaining
    db.add(user)

    now = datetime.now(timezone.utc)
    log_activity(
        db,
        actor_user_id=user.id,
        activity_type="USER_LOGIN",
        message="User logged in (backup code)",
        payload={"at": now.isoformat(), "mfa": True, "backup_code": True, "remaining_codes": len(remaining)},
    )
    record_heartbeat(db, user_id=user.id)
    db.commit()
    db.refresh(user)

    _log_auth_event("mfa_backup_success", request=request, extra={"user_id": user.id, "remaining_codes": len(remaining)})
    return _build_full_login_response(user, db)


@router.post("/totp/regenerate-backup-codes", response_model=BackupCodesResponse)
def regenerate_backup_codes(
    body: TOTPVerifySetupRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BackupCodesResponse:
    """Regenerate backup codes. Requires a valid TOTP code to confirm identity.

    Old backup codes are invalidated and replaced with new ones.
    """
    if not current_user.totp_enabled or not current_user.totp_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TOTP MFA must be enabled first")

    totp = pyotp.TOTP(current_user.totp_secret)
    if not totp.verify(body.totp_code, valid_window=1):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid TOTP code")

    plaintext_codes, hashed_codes = generate_backup_codes()
    current_user.backup_codes_hash = hashed_codes
    db.add(current_user)

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="USER_BACKUP_CODES_REGENERATED",
        message="User regenerated backup codes",
    )

    db.commit()
    return BackupCodesResponse(backup_codes=plaintext_codes, count=len(plaintext_codes))


# ── Step-Up MFA ──────────────────────────────────────────────────────────


@router.post("/step-up/verify", response_model=StepUpTokenResponse)
def step_up_verify(
    body: StepUpVerifyRequest,
    current_user: User = Depends(get_current_user),
) -> StepUpTokenResponse:
    """Re-authenticate with TOTP to obtain a short-lived step-up token.

    The step-up token is passed in the ``X-Step-Up-Token`` header on
    subsequent requests that require elevated assurance (e.g. disabling
    MFA, changing roles, fee overrides).
    """
    if not current_user.totp_enabled or not current_user.totp_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA is not enabled — step-up not available",
        )
    totp = pyotp.TOTP(current_user.totp_secret)
    if not totp.verify(body.totp_code, valid_window=1):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid TOTP code",
        )
    token = create_step_up_token(current_user.id)
    return StepUpTokenResponse(step_up_token=token)


# ── Existing endpoints ───────────────────────────────────────────────────


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register_user(
    user_in: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserRead:
    if not rbac.get_capabilities_for_user(current_user).get("manage_users"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to register users")

    primary_role, roles = rbac.normalize_roles_input(user_in.role, user_in.roles)
    if Role.EXTERNAL_PARTNER in roles and len(roles) > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="External partner cannot be combined with other roles",
        )
    if Role.EXTERNAL_PARTNER in roles and not user_in.partner_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="partner_id is required for external partners")
    if Role.EXTERNAL_PARTNER not in roles and user_in.partner_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="partner_id is only allowed for external partners")
    if user_in.partner_id:
        partner = db.get(ExternalPartner, user_in.partner_id)
        if not partner:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid partner_id")

    existing = db.query(User).filter(User.email == user_in.email.lower()).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User with this email already exists")

    user = User(
        email=user_in.email.lower(),
        hashed_password=get_password_hash(user_in.password),
        full_name=user_in.full_name,
        phone=user_in.phone,
        role=primary_role,
        roles=[role.value for role in roles],
        partner_id=user_in.partner_id,
        is_active=user_in.is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserRead.model_validate(user)


@router.get("/me", response_model=UserRead)
def get_me(current_user: User = Depends(get_current_user)) -> UserRead:
    return UserRead.model_validate(current_user)


@router.patch("/me", response_model=UserRead)
def update_me(
    user_update: UserSelfUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserRead:
    update_data = user_update.model_dump(exclude_unset=True)

    new_email = update_data.get("email")
    if new_email:
        existing = db.query(User).filter(User.email == new_email, User.id != current_user.id).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already in use")
        current_user.email = new_email

    if "full_name" in update_data:
        current_user.full_name = update_data["full_name"]
    if "phone" in update_data:
        current_user.phone = update_data["phone"]

    new_password = update_data.get("password")
    if new_password:
        current_password = update_data.get("current_password")
        if not current_password or not verify_password(str(current_password), current_user.hashed_password):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is invalid")
        current_user.hashed_password = get_password_hash(str(new_password))
        log_activity(
            db,
            actor_user_id=current_user.id,
            activity_type="USER_PASSWORD_CHANGED",
            message="User changed password",
        )

    current_user.updated_at = datetime.now(timezone.utc)
    db.add(current_user)

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="USER_PROFILE_UPDATED",
        message="User updated profile",
        payload={"email": current_user.email},
    )

    db.commit()
    db.refresh(current_user)
    return UserRead.model_validate(current_user)


@router.post("/heartbeat", response_model=LoginResponse)
def heartbeat(
    request: Request,
    token: str = Depends(oauth2_scheme),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LoginResponse:
    """Refresh session activity.

    Returns a new JWT with an updated ``last_activity`` timestamp.  The
    frontend should call this periodically (e.g. every 5 minutes) to keep
    the session alive while the user is actively interacting with the
    application.  The old token is **not** revoked — it will expire
    naturally or be caught by the idle-timeout check in ``get_current_user``.
    """
    capabilities = rbac.get_capabilities_for_user(current_user)
    roles_payload = [role.value for role in rbac.roles_for_user(current_user)]

    # Carry forward the original issued-at time so absolute session lifetime
    # is still measured from the very first login.
    try:
        old_payload = decode_token(token)
        original_iat = old_payload.get("iat")
    except Exception:
        original_iat = None

    new_token = create_access_token({
        "sub": str(current_user.id),
        "role": current_user.role.value,
        "roles": roles_payload,
        **({"iat": original_iat} if original_iat else {}),
        # last_activity is set to "now" by create_access_token default
    })

    # Update attendance work session
    record_heartbeat(db, user_id=current_user.id)
    db.commit()

    return LoginResponse(
        access_token=new_token,
        user=UserRead.model_validate(current_user),
        capabilities=capabilities,
        mfa_required=False,
    )


@router.get("/capabilities", response_model=CapabilityResponse)
def get_capabilities(current_user: User = Depends(get_current_user)) -> CapabilityResponse:
    capabilities = rbac.get_capabilities_for_user(current_user)
    return CapabilityResponse(
        role=str(current_user.role),
        capabilities=capabilities,
        meta={"roles": [role.value for role in rbac.roles_for_user(current_user)]},
    )
