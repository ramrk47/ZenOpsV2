"""Partner onboarding — public request-access + admin approval flow."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.deps import get_current_user
from app.core.security import get_password_hash
from app.db.session import get_db
from app.models.enums import NotificationType, Role
from app.models.partner import ExternalPartner
from app.models.partner_account_request import PartnerAccountRequest
from app.models.user import User
from app.schemas.partner_onboarding import (
    PartnerAccountRequestCreate,
    PartnerAccountRequestDecision,
    PartnerAccountRequestRead,
)
from app.services.activity import log_activity
from app.services.notifications import notify_roles

router = APIRouter(tags=["partner-onboarding"])

# Rate-limit constants — re-use the existing login rate-limit logic
_MAX_REQUESTS_PER_EMAIL = 3  # max pending requests per email


# ── Public endpoint (NO AUTH) ───────────────────────────────────────────


@router.post(
    "/api/partner/request-access",
    response_model=PartnerAccountRequestRead,
    status_code=status.HTTP_201_CREATED,
)
def request_access(
    body: PartnerAccountRequestCreate,
    db: Session = Depends(get_db),
):
    """Submit a partner account request.  No authentication required."""
    email = body.email.lower().strip()

    # Simple rate-limit — prevent duplicate pending requests
    existing_pending = (
        db.query(PartnerAccountRequest)
        .filter(
            PartnerAccountRequest.email == email,
            PartnerAccountRequest.status == "PENDING",
        )
        .count()
    )
    if existing_pending >= _MAX_REQUESTS_PER_EMAIL:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="A request with this email is already pending",
        )

    req = PartnerAccountRequest(
        company_name=body.company_name.strip(),
        contact_name=body.contact_name.strip(),
        email=email,
        phone=body.phone,
        message=body.message,
        status="PENDING",
    )
    db.add(req)
    db.flush()

    # Notify admin roles
    notify_roles(
        db,
        roles=[Role.ADMIN, Role.OPS_MANAGER],
        notif_type=NotificationType.PARTNER_REQUEST_SUBMITTED,
        message=f"New partner access request from {req.company_name}",
        payload={"request_id": req.id, "company_name": req.company_name, "email": email},
    )

    db.commit()
    db.refresh(req)
    return PartnerAccountRequestRead.model_validate(req)


# ── Admin endpoints ─────────────────────────────────────────────────────


def _require_admin(user: User) -> None:
    if not rbac.user_has_any_role(user, {Role.ADMIN, Role.OPS_MANAGER}):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised")


@router.get("/api/admin/partner-account-requests", response_model=List[PartnerAccountRequestRead])
def list_partner_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[PartnerAccountRequestRead]:
    """List all partner account requests (admin only)."""
    _require_admin(current_user)
    requests = (
        db.query(PartnerAccountRequest)
        .order_by(PartnerAccountRequest.created_at.desc())
        .all()
    )
    return [PartnerAccountRequestRead.model_validate(r) for r in requests]


@router.post(
    "/api/admin/partner-account-requests/{request_id}/approve",
    response_model=PartnerAccountRequestRead,
)
def approve_partner_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PartnerAccountRequestRead:
    """Approve a partner request — creates ExternalPartner + User account."""
    _require_admin(current_user)
    req = db.get(PartnerAccountRequest, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status != "PENDING":
        raise HTTPException(status_code=400, detail="Request already decided")

    now = datetime.now(timezone.utc)

    # Check if a user with this email already exists
    existing_user = db.query(User).filter(User.email == req.email.lower()).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A user with email {req.email} already exists",
        )

    # Create ExternalPartner record
    partner = ExternalPartner(
        display_name=req.company_name,
        contact_name=req.contact_name,
        email=req.email.lower(),
        phone=req.phone,
        is_active=True,
    )
    db.add(partner)
    db.flush()

    # Create User with EXTERNAL_PARTNER role and a random temporary password
    import secrets
    temp_password = secrets.token_urlsafe(16)
    user = User(
        email=req.email.lower(),
        hashed_password=get_password_hash(temp_password),
        full_name=req.contact_name,
        phone=req.phone,
        role=Role.EXTERNAL_PARTNER,
        roles=[Role.EXTERNAL_PARTNER.value],
        partner_id=partner.id,
        is_active=True,
    )
    db.add(user)
    db.flush()

    # Update request
    req.status = "APPROVED"
    req.reviewed_by_user_id = current_user.id
    req.reviewed_at = now
    req.created_user_id = user.id
    req.updated_at = now
    db.add(req)

    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="PARTNER_REQUEST_APPROVED",
        message=f"Partner request approved for {req.company_name}",
        payload={"request_id": req.id, "partner_id": partner.id, "user_id": user.id},
    )

    db.commit()
    db.refresh(req)
    return PartnerAccountRequestRead.model_validate(req)


@router.post(
    "/api/admin/partner-account-requests/{request_id}/reject",
    response_model=PartnerAccountRequestRead,
)
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
    if req.status != "PENDING":
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
        activity_type="PARTNER_REQUEST_REJECTED",
        message=f"Partner request rejected for {req.company_name}",
        payload={"request_id": req.id, "reason": body.rejection_reason},
    )

    db.commit()
    db.refresh(req)
    return PartnerAccountRequestRead.model_validate(req)
