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
from app.core.security import get_password_hash
from app.core.settings import settings
from app.db.session import get_db
from app.models.enums import NotificationType, Role
from app.models.partner import ExternalPartner
from app.models.partner_account_request import PartnerAccountRequest
from app.models.partner_request_attempt import PartnerRequestAttempt
from app.models.user import User
from app.models.user_invite import UserInvite
from app.schemas.partner_onboarding import (
    PartnerAccountRequestCreate,
    PartnerAccountRequestDecision,
    PartnerAccountRequestRead,
    PartnerAccessResendPayload,
    PartnerAccessVerifyPayload,
)
from app.services.activity import log_activity
from app.services.email_delivery import create_email_delivery
from app.services.invites import create_invite
from app.services.notifications import notify_roles
from app.services.rate_limit import consume_rate_limit, get_client_ip

router = APIRouter(tags=["partner-onboarding"])

MODE_INVITE_ONLY = "INVITE_ONLY"
MODE_REQUEST_ACCESS_REVIEW = "REQUEST_ACCESS_REVIEW"
MODE_REQUEST_ACCESS_AUTO_APPROVE = "REQUEST_ACCESS_AUTO_APPROVE"

STATUS_PENDING_EMAIL_VERIFY = "PENDING_EMAIL_VERIFY"
STATUS_VERIFIED_PENDING_REVIEW = "VERIFIED_PENDING_REVIEW"
STATUS_APPROVED = "APPROVED"
STATUS_REJECTED = "REJECTED"
STATUS_EXPIRED = "EXPIRED"

LEGACY_STATUS_PENDING = "PENDING"
LEGACY_STATUS_VERIFIED = "VERIFIED"

ACTIVE_REQUEST_STATUSES = {
    STATUS_PENDING_EMAIL_VERIFY,
    STATUS_VERIFIED_PENDING_REVIEW,
    LEGACY_STATUS_PENDING,
    LEGACY_STATUS_VERIFIED,
}
VERIFY_ELIGIBLE_STATUSES = {
    STATUS_PENDING_EMAIL_VERIFY,
    LEGACY_STATUS_PENDING,
    LEGACY_STATUS_VERIFIED,
}
REVIEW_ELIGIBLE_STATUSES = {
    STATUS_VERIFIED_PENDING_REVIEW,
    LEGACY_STATUS_VERIFIED,
}


def _associate_onboarding_url(path: str) -> str:
    base = settings.app_base_url.rstrip("/")
    return f"{base}{path}"


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _current_onboarding_mode() -> str:
    mode = settings.associate_onboarding_mode_effective
    legacy_auto_approve = _auto_approve_non_prod_enabled()
    if mode == MODE_REQUEST_ACCESS_REVIEW and legacy_auto_approve:
        return MODE_REQUEST_ACCESS_AUTO_APPROVE
    return mode


def _normalize_request_names(body: PartnerAccountRequestCreate) -> tuple[str, str]:
    company_name = (body.company_name or body.firm_name or "").strip()
    contact_name = (body.contact_name or body.name or "").strip()
    if not company_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="company_name is required")
    if not contact_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="contact_name is required")
    return company_name, contact_name


def _email_domain(email: str) -> str:
    if "@" not in email:
        return ""
    return email.split("@", 1)[1].strip().lower()


def _auto_approve_domain_allowed(email: str) -> bool:
    allowed_domains = {domain.strip().lower() for domain in (settings.associate_auto_approve_domains or []) if domain.strip()}
    if not allowed_domains:
        return True
    return _email_domain(email) in allowed_domains


def _create_verification_token(req: PartnerAccountRequest) -> str:
    raw_token = secrets.token_urlsafe(32)
    req.email_verification_token = _hash_token(raw_token)
    req.token_expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.associate_verify_token_ttl_minutes)
    req.token_consumed_at = None
    return raw_token


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


def _consume_request_rate_limits(db: Session, *, email: str, request_ip: str | None):
    ip_limit = None
    if request_ip:
        ip_limit = consume_rate_limit(
            db,
            key=f"request_access:ip:{request_ip}",
            limit=settings.rate_limit_request_access_ip_max,
            window_seconds=settings.rate_limit_request_access_ip_window_seconds,
        )

    email_limit = consume_rate_limit(
        db,
        key=f"request_access:email:{email}",
        limit=settings.rate_limit_request_access_email_max,
        window_seconds=settings.rate_limit_request_access_email_window_seconds,
    )
    return ip_limit, email_limit


def _consume_verify_rate_limits(db: Session, *, request_ip: str | None):
    ip_limit = None
    if request_ip:
        ip_limit = consume_rate_limit(
            db,
            key=f"request_access_verify:ip:{request_ip}",
            limit=settings.rate_limit_login_ip_max,
            window_seconds=settings.rate_limit_login_ip_window_seconds,
        )
    return ip_limit


def _consume_resend_rate_limits(db: Session, *, email: str, request_ip: str | None):
    ip_limit = None
    if request_ip:
        ip_limit = consume_rate_limit(
            db,
            key=f"request_access_resend:ip:{request_ip}",
            limit=settings.rate_limit_request_access_ip_max,
            window_seconds=settings.rate_limit_request_access_ip_window_seconds,
        )
    email_limit = consume_rate_limit(
        db,
        key=f"request_access_resend:email:{email}",
        limit=settings.rate_limit_request_access_email_max,
        window_seconds=settings.rate_limit_request_access_email_window_seconds,
    )
    return ip_limit, email_limit


def _mark_request_expired(req: PartnerAccountRequest) -> None:
    now = datetime.now(timezone.utc)
    req.status = STATUS_EXPIRED
    req.updated_at = now


def _can_auto_approve_request(db: Session, *, req: PartnerAccountRequest) -> bool:
    if not _auto_approve_domain_allowed(req.email):
        return False
    daily_bucket = consume_rate_limit(
        db,
        key=f"associate_auto_approve:day:{datetime.now(timezone.utc).strftime('%Y-%m-%d')}",
        limit=settings.associate_auto_approve_max_per_day,
        window_seconds=86400,
    )
    return daily_bucket.allowed


def _queue_verification_email(db: Session, req: PartnerAccountRequest, *, raw_token: str) -> None:
    verify_link = _associate_onboarding_url(f"/partner/verify?token={raw_token}")
    html = (
        "<p>Thanks for requesting External Associate access.</p>"
        "<p>Please verify your email to continue:</p>"
        f"<p><a href=\"{verify_link}\">Verify Email</a></p>"
        f"<p>This one-time link expires in {settings.associate_verify_token_ttl_minutes} minutes.</p>"
    )
    text = (
        "Thanks for requesting External Associate access.\n"
        f"Verify email: {verify_link}\n"
        f"This one-time link expires in {settings.associate_verify_token_ttl_minutes} minutes.\n"
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


def _auto_approve_non_prod_enabled() -> bool:
    return bool(settings.associate_auto_approve) and not settings.is_production


def _auto_approve_request(db: Session, *, req: PartnerAccountRequest) -> None:
    now = datetime.now(timezone.utc)
    existing_user = db.query(User).filter(User.email == req.email.lower()).first()
    if existing_user and not rbac.user_has_role(existing_user, Role.EXTERNAL_PARTNER):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Email {req.email} is already used by an internal account",
        )

    partner: ExternalPartner | None = None
    if existing_user and existing_user.partner_id:
        partner = db.get(ExternalPartner, existing_user.partner_id)
        if partner:
            partner.is_active = True
            db.add(partner)

    if not partner:
        partner = ExternalPartner(
            display_name=req.company_name,
            legal_name=req.company_name,
            contact_name=req.contact_name,
            email=req.email,
            phone=req.phone,
            city=req.city,
            is_active=True,
            notes="Auto-provisioned from associate self-serve onboarding",
        )
        db.add(partner)
        db.flush()

    if existing_user:
        user = existing_user
        user.role = Role.EXTERNAL_PARTNER
        user.roles = [Role.EXTERNAL_PARTNER.value]
        user.partner_id = partner.id
        user.is_active = True
        user.hashed_password = get_password_hash(settings.associate_auto_approve_password)
        if not user.full_name:
            user.full_name = req.contact_name
        if req.phone:
            user.phone = req.phone
        db.add(user)
        db.flush()
    else:
        user = User(
            email=req.email.lower(),
            hashed_password=get_password_hash(settings.associate_auto_approve_password),
            full_name=req.contact_name,
            phone=req.phone,
            role=Role.EXTERNAL_PARTNER,
            roles=[Role.EXTERNAL_PARTNER.value],
            partner_id=partner.id,
            is_active=True,
        )
        db.add(user)
        db.flush()

    req.status = STATUS_APPROVED
    req.email_verified_at = req.email_verified_at or now
    req.approved_at = now
    req.reviewed_by_user_id = None
    req.reviewed_at = now
    req.created_user_id = user.id
    req.email_verification_token = None
    req.token_consumed_at = req.token_consumed_at or now
    req.updated_at = now
    db.add(req)

    log_activity(
        db,
        actor_user_id=user.id,
        activity_type="ASSOCIATE_ACCESS_AUTO_PROVISIONED",
        message=f"Associate request auto-provisioned for {req.email}",
        payload={"request_id": req.id, "partner_id": partner.id, "user_id": user.id},
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
    company_name, contact_name = _normalize_request_names(body)
    request_ip = get_client_ip(request)
    user_agent = request.headers.get("user-agent")
    mode = _current_onboarding_mode()
    verify_required = bool(settings.associate_email_verify_required)

    if mode == MODE_INVITE_ONLY:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "ASSOCIATE_INVITE_ONLY", "message": "Public onboarding is disabled in invite-only mode"},
        )

    if settings.is_production and settings.associate_request_require_captcha_in_production:
        if not (body.captcha_token or "").strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="captcha_token is required in production",
            )

    ip_limit, email_limit = _consume_request_rate_limits(db, email=email, request_ip=request_ip)
    if (ip_limit and not ip_limit.allowed) or (not email_limit.allowed):
        log_activity(
            db,
            actor_user_id=None,
            activity_type="ASSOCIATE_ACCESS_RATE_LIMIT",
            message="Associate request-access rate limited",
            payload={
                "email": email,
                "ip": request_ip,
                "limits": {
                    "ip": (
                        {
                            "count": ip_limit.count,
                            "limit": ip_limit.limit,
                            "retry_after_seconds": ip_limit.retry_after_seconds,
                        }
                        if ip_limit
                        else None
                    ),
                    "email": {
                        "count": email_limit.count,
                        "limit": email_limit.limit,
                        "retry_after_seconds": email_limit.retry_after_seconds,
                    },
                },
            },
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RATE_LIMITED", "message": "Too many access requests"},
        )

    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user and not rbac.user_has_role(existing_user, Role.EXTERNAL_PARTNER):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Email {email} is already used by an internal account",
        )

    # Prevent duplicate active requests for same email.
    existing_pending = (
        db.query(PartnerAccountRequest)
        .filter(
            PartnerAccountRequest.email == email,
            PartnerAccountRequest.status.in_(list(ACTIVE_REQUEST_STATUSES)),
        )
        .count()
    )
    if existing_pending > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An active access request for this email already exists",
        )

    req = PartnerAccountRequest(
        company_name=company_name,
        contact_name=contact_name,
        email=email,
        phone=body.phone,
        city=(body.city or "").strip() or None,
        message=body.message,
        role_intent=(body.role_intent or "").strip() or None,
        requested_interface=(body.requested_interface or "associate").strip().lower(),
        metadata_json={
            "interface": (body.requested_interface or "associate").strip().lower(),
            "mode": mode,
            "auto_approve_domains": settings.associate_auto_approve_domains or [],
        },
        status=STATUS_PENDING_EMAIL_VERIFY if verify_required else STATUS_VERIFIED_PENDING_REVIEW,
        request_ip=request_ip,
        user_agent=user_agent,
        rate_limit_bucket=f"{(request_ip or email)}:{datetime.now(timezone.utc).strftime('%Y-%m-%d')}",
    )
    raw_verify_token = None
    if verify_required:
        raw_verify_token = _create_verification_token(req)

    db.add(req)
    db.flush()
    _record_attempt(db, email=email, request_ip=request_ip, user_agent=user_agent)

    if verify_required and raw_verify_token:
        _queue_verification_email(db, req, raw_token=raw_verify_token)

    if not verify_required:
        req.email_verified_at = datetime.now(timezone.utc)
        if mode == MODE_REQUEST_ACCESS_AUTO_APPROVE and _can_auto_approve_request(db, req=req):
            _auto_approve_request(db, req=req)
        else:
            req.status = STATUS_VERIFIED_PENDING_REVIEW
            req.updated_at = datetime.now(timezone.utc)
            db.add(req)

    if req.status in {STATUS_PENDING_EMAIL_VERIFY, STATUS_VERIFIED_PENDING_REVIEW, LEGACY_STATUS_PENDING, LEGACY_STATUS_VERIFIED}:
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


def _verify_access_token(
    *,
    token: str,
    request_ip: str | None,
    db: Session,
) -> PartnerAccountRequestRead:
    token_hash = _hash_token(token.strip())
    req = (
        db.query(PartnerAccountRequest)
        .filter(PartnerAccountRequest.email_verification_token == token_hash)
        .first()
    )
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Verification token is invalid")

    ip_limit = _consume_verify_rate_limits(db, request_ip=request_ip)
    if ip_limit and not ip_limit.allowed:
        log_activity(
            db,
            actor_user_id=None,
            activity_type="ASSOCIATE_VERIFY_RATE_LIMIT",
            message="Associate verify-access rate limited",
            payload={"ip": request_ip, "request_id": req.id},
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RATE_LIMITED", "message": "Too many verification attempts"},
        )

    if req.token_consumed_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Verification token already used")
    expires_at = req.token_expires_at
    if expires_at:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= datetime.now(timezone.utc):
            _mark_request_expired(req)
            db.add(req)
            db.commit()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Verification token expired")

    if req.status not in VERIFY_ELIGIBLE_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request has already been decided")

    now = datetime.now(timezone.utc)
    mode = _current_onboarding_mode()
    req.email_verified_at = now
    req.token_consumed_at = now
    req.email_verification_token = None

    auto_approved = mode == MODE_REQUEST_ACCESS_AUTO_APPROVE and _can_auto_approve_request(db, req=req)
    if auto_approved:
        _auto_approve_request(db, req=req)
    else:
        req.status = STATUS_VERIFIED_PENDING_REVIEW
        req.updated_at = now
        db.add(req)

        notify_roles(
            db,
            roles=[Role.ADMIN, Role.OPS_MANAGER],
            notif_type=NotificationType.PARTNER_REQUEST_SUBMITTED,
            message=f"Verified external associate request ready for review: {req.company_name}",
            payload={"request_id": req.id, "company_name": req.company_name, "email": req.email, "status": req.status},
        )

    db.commit()
    db.refresh(req)
    return PartnerAccountRequestRead.model_validate(req)


@router.post("/api/partner/verify-access-token", response_model=PartnerAccountRequestRead)
@router.post("/api/partner/verify", response_model=PartnerAccountRequestRead)
def verify_access_request_email(
    payload: PartnerAccessVerifyPayload,
    request: Request,
    db: Session = Depends(get_db),
) -> PartnerAccountRequestRead:
    return _verify_access_token(token=payload.token, request_ip=get_client_ip(request), db=db)


@router.post("/api/partner/resend-verification", response_model=PartnerAccountRequestRead)
def resend_verification_email(
    body: PartnerAccessResendPayload,
    request: Request,
    db: Session = Depends(get_db),
) -> PartnerAccountRequestRead:
    mode = _current_onboarding_mode()
    if mode == MODE_INVITE_ONLY:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Public onboarding is disabled")

    email = body.email.lower().strip()
    request_ip = get_client_ip(request)
    user_agent = request.headers.get("user-agent")
    ip_limit, email_limit = _consume_resend_rate_limits(db, email=email, request_ip=request_ip)
    if (ip_limit and not ip_limit.allowed) or (not email_limit.allowed):
        log_activity(
            db,
            actor_user_id=None,
            activity_type="ASSOCIATE_RESEND_RATE_LIMIT",
            message="Associate resend verification rate limited",
            payload={"email": email, "ip": request_ip},
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RATE_LIMITED", "message": "Too many verification resend attempts"},
        )

    req = (
        db.query(PartnerAccountRequest)
        .filter(
            PartnerAccountRequest.email == email,
            PartnerAccountRequest.status.in_(list(ACTIVE_REQUEST_STATUSES | {STATUS_EXPIRED})),
        )
        .order_by(PartnerAccountRequest.created_at.desc())
        .first()
    )
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active access request found")
    if req.status not in {STATUS_PENDING_EMAIL_VERIFY, STATUS_EXPIRED, LEGACY_STATUS_PENDING}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request does not require verification")

    now = datetime.now(timezone.utc)
    req.status = STATUS_PENDING_EMAIL_VERIFY
    req.request_ip = request_ip or req.request_ip
    req.user_agent = user_agent or req.user_agent
    req.updated_at = now
    raw_token = _create_verification_token(req)
    db.add(req)

    _queue_verification_email(db, req, raw_token=raw_token)
    log_activity(
        db,
        actor_user_id=None,
        activity_type="ASSOCIATE_VERIFY_RESENT",
        message=f"Associate verification email resent for {email}",
        payload={"request_id": req.id},
    )

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
    if req.status not in (REVIEW_ELIGIBLE_STATUSES | {LEGACY_STATUS_PENDING}):
        raise HTTPException(status_code=400, detail="Request already decided")
    if req.status in {LEGACY_STATUS_PENDING, STATUS_PENDING_EMAIL_VERIFY}:
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
    req.status = STATUS_APPROVED
    req.approved_at = now
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
    if req.status not in (ACTIVE_REQUEST_STATUSES | {STATUS_EXPIRED}):
        raise HTTPException(status_code=400, detail="Request already decided")

    now = datetime.now(timezone.utc)
    req.status = STATUS_REJECTED
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
