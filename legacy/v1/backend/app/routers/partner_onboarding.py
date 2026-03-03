"""Associate onboarding — public request-access + admin approval flow."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import secrets
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.deps import get_current_user
from app.core.settings import settings
from app.db.session import get_db
from app.models.enums import NotificationType, Role
from app.models.partner_account_request import PartnerAccountRequest
from app.models.partner_request_attempt import PartnerRequestAttempt
from app.models.user import User
from app.models.user_invite import UserInvite
from app.schemas.partner_onboarding import (
    PartnerAccountRequestCreate,
    PartnerAccountRequestDecision,
    PartnerAccountRequestRead,
    PartnerAccessVerifyPayload,
)
from app.services.activity import log_activity
from app.services.email_delivery import create_email_delivery
from app.services.invites import create_invite
from app.services.notifications import notify_roles

router = APIRouter(tags=["partner-onboarding"])

_MAX_REQUESTS_PER_IP_PER_DAY = 3
_MAX_REQUESTS_PER_EMAIL_PER_DAY = 2


def _associate_onboarding_url(path: str) -> str:
    base = settings.app_base_url.rstrip("/")
    return f"{base}{path}"


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _record_attempt(db: Session, *, email: str, request_ip: str | None, user_agent: str | None) -> None:
    bucket_source = request_ip or email
    day_bucket = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    attempt = PartnerRequestAttempt(
        email=email,
        request_ip=request_ip,
        user_agent=user_agent,
        rate_limit_bucket=f"{bucket_source}:{day_bucket}",
    )
    db.add(attempt)
    db.flush()


def _enforce_request_rate_limits(db: Session, *, email: str, request_ip: str | None) -> None:
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(hours=24)

    email_attempts = (
        db.query(PartnerRequestAttempt)
        .filter(
            PartnerRequestAttempt.email == email,
            PartnerRequestAttempt.created_at >= window_start,
        )
        .count()
    )
    if email_attempts >= _MAX_REQUESTS_PER_EMAIL_PER_DAY:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many access requests for this email in the last 24 hours",
        )

    if request_ip:
        ip_attempts = (
            db.query(PartnerRequestAttempt)
            .filter(
                PartnerRequestAttempt.request_ip == request_ip,
                PartnerRequestAttempt.created_at >= window_start,
            )
            .count()
        )
        if ip_attempts >= _MAX_REQUESTS_PER_IP_PER_DAY:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many access requests from this network in the last 24 hours",
            )


def _queue_verification_email(db: Session, req: PartnerAccountRequest, *, raw_token: str) -> None:
    verify_link = _associate_onboarding_url(f"/partner/verify?token={raw_token}")
    html = (
        "<p>Thanks for requesting External Associate access.</p>"
        "<p>Please verify your email to continue:</p>"
        f"<p><a href=\"{verify_link}\">Verify Email</a></p>"
        "<p>This link can be used once and will remain valid while the request is pending.</p>"
    )
    text = (
        "Thanks for requesting External Associate access.\n"
        f"Verify email: {verify_link}\n"
    )
    create_email_delivery(
        db,
        event_type="ASSOCIATE_ACCESS_VERIFY",
        to_email=req.email,
        subject="Verify your External Associate access request",
        html=html,
        text=text,
        idempotency_key=f"associate-verify:{req.id}:{_hash_token(raw_token)[:16]}",
        payload={"request_id": req.id},
    )


def _queue_invite_email(db: Session, *, request_id: int, invite: UserInvite, raw_token: str) -> None:
    invite_link = _associate_onboarding_url(f"/invite/accept?token={raw_token}")
    html = (
        "<p>Your External Associate access request has been approved.</p>"
        "<p>Set your password using this one-time invite link:</p>"
        f"<p><a href=\"{invite_link}\">Accept Invite</a></p>"
        "<p>This link expires in 48 hours and can only be used once.</p>"
    )
    text = (
        "Your External Associate access request has been approved.\n"
        f"Accept invite: {invite_link}\n"
        "This link expires in 48 hours and is one-time use.\n"
    )
    create_email_delivery(
        db,
        event_type="ASSOCIATE_ACCESS_INVITE",
        to_email=invite.email,
        subject="External Associate invite: set your password",
        html=html,
        text=text,
        idempotency_key=f"associate-invite:{request_id}:{invite.id}",
        payload={"request_id": request_id, "invite_id": invite.id},
    )


# ── Public endpoint (NO AUTH) ───────────────────────────────────────────


@router.post(
    "/api/partner/request-access",
    response_model=PartnerAccountRequestRead,
    status_code=status.HTTP_201_CREATED,
)
def request_access(
    request: Request,
    body: PartnerAccountRequestCreate,
    db: Session = Depends(get_db),
):
    """Submit an External Associate account request (public endpoint)."""
    email = body.email.lower().strip()
    request_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")

    if settings.environment.lower() in ("production", "prod") and settings.associate_request_require_captcha_in_production:
        if not (body.captcha_token or "").strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="captcha_token is required in production",
            )

    _enforce_request_rate_limits(db, email=email, request_ip=request_ip)

    # Prevent duplicate active requests for same email.
    existing_pending = (
        db.query(PartnerAccountRequest)
        .filter(
            PartnerAccountRequest.email == email,
            PartnerAccountRequest.status.in_(["PENDING", "VERIFIED"]),
        )
        .count()
    )
    if existing_pending > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An active access request for this email already exists",
        )

    raw_verify_token = secrets.token_urlsafe(32)

    req = PartnerAccountRequest(
        company_name=body.company_name.strip(),
        contact_name=body.contact_name.strip(),
        email=email,
        phone=body.phone,
        message=body.message,
        status="PENDING",
        email_verification_token=_hash_token(raw_verify_token),
        request_ip=request_ip,
        user_agent=user_agent,
        rate_limit_bucket=f"{(request_ip or email)}:{datetime.now(timezone.utc).strftime('%Y-%m-%d')}",
    )
    db.add(req)
    db.flush()
    _record_attempt(db, email=email, request_ip=request_ip, user_agent=user_agent)

    _queue_verification_email(db, req, raw_token=raw_verify_token)

    # Notify admin roles (request entered system; verification pending).
    notify_roles(
        db,
        roles=[Role.ADMIN, Role.OPS_MANAGER],
        notif_type=NotificationType.PARTNER_REQUEST_SUBMITTED,
        message=f"New external associate access request from {req.company_name}",
        payload={"request_id": req.id, "company_name": req.company_name, "email": email, "status": req.status},
    )

    db.commit()
    db.refresh(req)
    return PartnerAccountRequestRead.model_validate(req)


@router.post("/api/partner/verify", response_model=PartnerAccountRequestRead)
def verify_access_request_email(
    payload: PartnerAccessVerifyPayload,
    db: Session = Depends(get_db),
) -> PartnerAccountRequestRead:
    token_hash = _hash_token(payload.token.strip())
    req = (
        db.query(PartnerAccountRequest)
        .filter(PartnerAccountRequest.email_verification_token == token_hash)
        .first()
    )
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Verification token is invalid")
    if req.status not in {"PENDING", "VERIFIED"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request has already been decided")

    now = datetime.now(timezone.utc)
    req.email_verified_at = now
    req.status = "VERIFIED"
    req.updated_at = now
    db.add(req)
    db.commit()
    db.refresh(req)
    return PartnerAccountRequestRead.model_validate(req)


# ── Admin endpoints ─────────────────────────────────────────────────────


def _require_admin(user: User) -> None:
    if not rbac.user_has_any_role(user, {Role.ADMIN, Role.OPS_MANAGER}):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised")


@router.get("/api/admin/partner-account-requests", response_model=List[PartnerAccountRequestRead])
@router.get("/api/admin/associate-access-requests", response_model=List[PartnerAccountRequestRead])
def list_partner_requests(
    status_filter: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[PartnerAccountRequestRead]:
    """List all associate account requests (admin only)."""
    _require_admin(current_user)
    query = db.query(PartnerAccountRequest)
    if status_filter:
        query = query.filter(PartnerAccountRequest.status == status_filter.upper())
    requests = query.order_by(PartnerAccountRequest.created_at.desc()).all()
    return [PartnerAccountRequestRead.model_validate(r) for r in requests]


@router.post("/api/admin/partner-account-requests/{request_id}/approve", response_model=PartnerAccountRequestRead)
@router.post("/api/admin/associate-access-requests/{request_id}/approve", response_model=PartnerAccountRequestRead)
def approve_partner_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PartnerAccountRequestRead:
    """Approve an External Associate request and issue one-time invite."""
    _require_admin(current_user)
    req = db.get(PartnerAccountRequest, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status not in {"VERIFIED", "PENDING"}:
        raise HTTPException(status_code=400, detail="Request already decided")
    if req.status == "PENDING":
        raise HTTPException(status_code=400, detail="Request email must be verified before approval")

    now = datetime.now(timezone.utc)
    existing_user = db.query(User).filter(User.email == req.email.lower()).first()
    if existing_user and existing_user.is_active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"A user with email {req.email} already exists")
    existing_open_invite = (
        db.query(UserInvite)
        .filter(
            UserInvite.email == req.email.lower(),
            UserInvite.used_at.is_(None),
            UserInvite.expires_at > now,
        )
        .first()
    )
    if existing_open_invite:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An active invite already exists for this email")

    invite, raw_token = create_invite(
        db,
        email=req.email,
        role=Role.EXTERNAL_PARTNER,
        created_by_user_id=current_user.id,
        metadata_json={
            "request_id": req.id,
            "company_name": req.company_name,
            "contact_name": req.contact_name,
            "phone": req.phone,
            "message": req.message,
        },
    )
    _queue_invite_email(db, request_id=req.id, invite=invite, raw_token=raw_token)

    # Update request
    req.status = "APPROVED"
    req.reviewed_by_user_id = current_user.id
    req.reviewed_at = now
    req.created_user_id = None
    req.updated_at = now
    db.add(req)

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="ASSOCIATE_ACCESS_REQUEST_APPROVED",
        message=f"External Associate access approved for {req.company_name}",
        payload={"request_id": req.id, "invite_id": invite.id},
    )
    notify_roles(
        db,
        roles=[Role.ADMIN, Role.OPS_MANAGER],
        notif_type=NotificationType.PARTNER_REQUEST_APPROVED,
        message=f"External Associate invite created for {req.company_name}",
        payload={"request_id": req.id, "invite_id": invite.id},
        exclude_user_ids=[current_user.id],
    )

    db.commit()
    db.refresh(req)
    return PartnerAccountRequestRead.model_validate(req)


@router.post("/api/admin/partner-account-requests/{request_id}/reject", response_model=PartnerAccountRequestRead)
@router.post("/api/admin/associate-access-requests/{request_id}/reject", response_model=PartnerAccountRequestRead)
def reject_partner_request(
    request_id: int,
    body: PartnerAccountRequestDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PartnerAccountRequestRead:
    """Reject a partner request."""
    _require_admin(current_user)
    req = db.get(PartnerAccountRequest, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status not in {"PENDING", "VERIFIED"}:
        raise HTTPException(status_code=400, detail="Request already decided")

    now = datetime.now(timezone.utc)
    req.status = "REJECTED"
    req.rejection_reason = body.rejection_reason
    req.reviewed_by_user_id = current_user.id
    req.reviewed_at = now
    req.updated_at = now
    db.add(req)

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="ASSOCIATE_ACCESS_REQUEST_REJECTED",
        message=f"External Associate access rejected for {req.company_name}",
        payload={"request_id": req.id, "reason": body.rejection_reason},
    )

    db.commit()
    db.refresh(req)
    return PartnerAccountRequestRead.model_validate(req)
