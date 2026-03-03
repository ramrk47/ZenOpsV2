from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.deps import get_current_user
from app.core.security import get_password_hash
from app.core.settings import settings
from app.core.step_up import require_step_up
from app.db.session import get_db
from app.models.approval import Approval
from app.models.assignment import Assignment
from app.models.audit import ActivityLog
from app.models.enums import (
    ApprovalActionType,
    ApprovalEntityType,
    ApprovalStatus,
    NotificationType,
    Role,
    TaskStatus,
)
from app.models.partner import ExternalPartner
from app.models.task import AssignmentTask
from app.models.user import User
from app.schemas.approval import ApprovalRead
from app.schemas.user import ResetPasswordPayload, UserCreate, UserDirectory, UserRead, UserSummary, UserUpdate
from app.services.activity import log_activity
from app.services.approvals import request_approval, required_roles_for_approval
from app.services.assignments import compute_due_info, get_assignment_assignee_ids, is_assignment_open
from app.services.leave import users_on_leave
from app.services.notifications import notify_roles
from app.services.rate_limit import consume_rate_limit, get_client_ip

router = APIRouter(prefix="/api/auth/users", tags=["users"])


def _require_manage_users(actor: User) -> None:
    if not rbac.get_capabilities_for_user(actor).get("manage_users"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised to manage users")


OPEN_TASK_STATUSES = {TaskStatus.TODO, TaskStatus.DOING, TaskStatus.BLOCKED}


def _normalize_allocation_prefs_json(raw_value):
    if raw_value is None:
        return None
    if not isinstance(raw_value, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="allocation_prefs_json must be an object")

    normalized = dict(raw_value)
    overrides = raw_value.get("service_line_overrides")
    if overrides is None:
        return normalized
    if not isinstance(overrides, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="allocation_prefs_json.service_line_overrides must be an object",
        )

    normalized_overrides = {}
    for key, value in overrides.items():
        service_line_key = str(key or "").strip().upper()
        if not service_line_key:
            continue
        if not isinstance(value, dict):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"allocation_prefs_json.service_line_overrides.{service_line_key} must be an object",
            )
        if "eligible" in value and value["eligible"] is not None and not isinstance(value["eligible"], bool):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"allocation_prefs_json.service_line_overrides.{service_line_key}.eligible must be boolean",
            )
        normalized_overrides[service_line_key] = {"eligible": value.get("eligible")}
    normalized["service_line_overrides"] = normalized_overrides
    return normalized


@router.get("/directory", response_model=List[UserDirectory])
def user_directory(
    include_inactive: bool = Query(False),
    exclude_partners: bool = Query(True),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> List[UserDirectory]:
    query = db.query(User)
    if not include_inactive:
        query = query.filter(User.is_active.is_(True))
    if exclude_partners:
        query = query.filter(User.role != Role.EXTERNAL_PARTNER)
    users = query.order_by(User.full_name.asc().nullslast(), User.email.asc()).all()
    return [UserDirectory.model_validate(user) for user in users]


@router.get("", response_model=List[UserSummary])
def list_users(
    include_inactive: bool = Query(True),
    role: Role | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[UserSummary]:
    _require_manage_users(current_user)

    query = db.query(User)
    if role:
        query = query.filter(User.has_role(role))
    if not include_inactive:
        query = query.filter(User.is_active.is_(True))
    users = query.order_by(User.created_at.asc()).all()

    assignments = (
        db.query(Assignment)
        .filter(Assignment.is_deleted.is_(False))
        .all()
    )
    leave_today = users_on_leave(db)

    now = datetime.now(timezone.utc)
    since = now - timedelta(days=30)
    soon_cutoff = now + timedelta(hours=48)
    user_ids = [u.id for u in users]
    login_rows = (
        db.query(ActivityLog)
        .filter(ActivityLog.type == "USER_LOGIN", ActivityLog.created_at >= since)
        .all()
    )
    login_counts: dict[int, int] = {}
    login_days: dict[int, set] = {}
    for log in login_rows:
        if not log.actor_user_id:
            continue
        login_counts[log.actor_user_id] = login_counts.get(log.actor_user_id, 0) + 1
        day = log.created_at.date()
        login_days.setdefault(log.actor_user_id, set()).add(day)

    open_counts: dict[int, int] = {u.id: 0 for u in users}
    overdue_counts: dict[int, int] = {u.id: 0 for u in users}
    due_soon_task_counts: dict[int, int] = {u.id: 0 for u in users}

    for assignment in assignments:
        if not is_assignment_open(assignment.status):
            continue
        assignee_ids = get_assignment_assignee_ids(assignment, include_primary=True)
        for assignee_id in assignee_ids:
            open_counts[assignee_id] = open_counts.get(assignee_id, 0) + 1
            if compute_due_info(assignment).due_state == "OVERDUE":
                overdue_counts[assignee_id] = overdue_counts.get(assignee_id, 0) + 1

    if user_ids:
        task_rows = (
            db.query(AssignmentTask)
            .filter(AssignmentTask.assigned_to_user_id.in_(user_ids))
            .all()
        )
        for task in task_rows:
            if not task.assigned_to_user_id:
                continue
            if task.status not in OPEN_TASK_STATUSES:
                continue
            if not task.due_at:
                continue
            due_at = task.due_at if task.due_at.tzinfo else task.due_at.replace(tzinfo=timezone.utc)
            if now <= due_at <= soon_cutoff:
                due_soon_task_counts[task.assigned_to_user_id] = due_soon_task_counts.get(task.assigned_to_user_id, 0) + 1

    last_active_at_map: dict[int, datetime] = {}
    last_active_minutes_map: dict[int, int] = {}
    if user_ids:
        activity_rows = (
            db.query(ActivityLog.actor_user_id, func.max(ActivityLog.created_at))
            .filter(ActivityLog.actor_user_id.in_(user_ids))
            .group_by(ActivityLog.actor_user_id)
            .all()
        )
        for user_id, last_active_at in activity_rows:
            if not user_id or not last_active_at:
                continue
            timestamp = last_active_at if last_active_at.tzinfo else last_active_at.replace(tzinfo=timezone.utc)
            last_active_at_map[user_id] = timestamp
            last_active_minutes_map[user_id] = int(max((now - timestamp).total_seconds(), 0) // 60)

    result: List[UserSummary] = []
    for user in users:
        summary = UserSummary.model_validate(user)
        summary.open_assignments = open_counts.get(user.id, 0)
        summary.overdue_assignments = overdue_counts.get(user.id, 0)
        summary.due_soon_tasks = due_soon_task_counts.get(user.id, 0)
        summary.last_active_at = last_active_at_map.get(user.id)
        summary.last_active_minutes = last_active_minutes_map.get(user.id)
        summary.on_leave_today = user.id in leave_today
        summary.login_count_30d = login_counts.get(user.id, 0)
        summary.active_days_30d = len(login_days.get(user.id, set()))
        result.append(summary)
    return result


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    user_in: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserRead:
    _require_manage_users(current_user)
    primary_role, roles = rbac.normalize_roles_input(user_in.role, user_in.roles)
    if Role.EXTERNAL_PARTNER in roles and len(roles) > 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="External partners cannot have multiple roles")
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
        allocation_prefs_json=_normalize_allocation_prefs_json(user_in.allocation_prefs_json),
    )
    if user_in.capability_overrides:
        base_caps = rbac.get_capabilities_for_roles(roles)
        overrides = {k: bool(v) for k, v in user_in.capability_overrides.items() if k in base_caps and v is not None}
        user.capability_overrides = overrides or None
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserRead.model_validate(user)


@router.get("/{user_id}", response_model=UserRead)
def get_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> UserRead:
    _require_manage_users(current_user)
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return UserRead.model_validate(user)


@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    user_id: int,
    user_update: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _step_up: dict = Depends(require_step_up),
) -> UserRead:
    _require_manage_users(current_user)
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    update_data = user_update.model_dump(exclude_unset=True)
    if "email" in update_data and update_data["email"]:
        new_email = str(update_data["email"]).lower()
        existing = db.query(User).filter(User.email == new_email, User.id != user.id).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already in use")
        user.email = new_email
    if "full_name" in update_data:
        user.full_name = update_data["full_name"]
    if "phone" in update_data:
        user.phone = update_data["phone"]
    incoming_role = update_data["role"] if "role" in update_data else user.role
    incoming_roles = update_data["roles"] if "roles" in update_data else user.roles
    primary_role, roles = rbac.normalize_roles_input(incoming_role, incoming_roles, default_role=user.role)
    target_partner_id = update_data["partner_id"] if "partner_id" in update_data else user.partner_id
    if Role.EXTERNAL_PARTNER in roles and len(roles) > 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="External partners cannot have multiple roles")
    if Role.EXTERNAL_PARTNER in roles and not target_partner_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="partner_id is required for external partners")
    if Role.EXTERNAL_PARTNER not in roles and target_partner_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="partner_id is only allowed for external partners")
    if "role" in update_data or "roles" in update_data:
        user.role = primary_role
        user.roles = [role.value for role in roles]
    if "partner_id" in update_data:
        if update_data["partner_id"]:
            partner = db.get(ExternalPartner, update_data["partner_id"])
            if not partner:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid partner_id")
        user.partner_id = update_data["partner_id"]
    if "is_active" in update_data and update_data["is_active"] is not None:
        user.is_active = bool(update_data["is_active"])
    if "password" in update_data and update_data["password"]:
        if not rbac.user_has_any_role(current_user, {Role.ADMIN, Role.HR}):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins or HR can set passwords directly")
        user.hashed_password = get_password_hash(update_data["password"])
    if "capability_overrides" in update_data:
        overrides = update_data["capability_overrides"] or None
        if overrides is not None:
            base_caps = rbac.get_capabilities_for_roles(roles)
            overrides = {k: bool(v) for k, v in overrides.items() if k in base_caps and v is not None}
            if not overrides:
                overrides = None
        user.capability_overrides = overrides
    if "allocation_prefs_json" in update_data:
        user.allocation_prefs_json = _normalize_allocation_prefs_json(update_data.get("allocation_prefs_json"))

    user.updated_at = datetime.now(timezone.utc)
    db.add(user)
    log_activity(
        db,
        actor_user_id=current_user.id,
        activity_type="USER_PROFILE_ADMIN_UPDATED",
        message="User profile updated by admin",
        payload={"user_id": user.id},
    )
    db.commit()
    db.refresh(user)
    return UserRead.model_validate(user)


@router.delete("/{user_id}", response_model=UserRead)
def deactivate_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> UserRead:
    _require_manage_users(current_user)
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.is_active = False
    user.updated_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserRead.model_validate(user)


@router.post("/{user_id}/reset-password", response_model=UserRead | ApprovalRead)
def reset_password(
    user_id: int,
    payload: ResetPasswordPayload,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _step_up: dict = Depends(require_step_up),
) -> UserRead | ApprovalRead:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    reset_limit = consume_rate_limit(
        db,
        key=f"password_reset:email:{user.email.lower()}",
        limit=settings.rate_limit_password_reset_email_max,
        window_seconds=settings.rate_limit_password_reset_email_window_seconds,
    )
    if not reset_limit.allowed:
        log_activity(
            db,
            actor_user_id=current_user.id,
            activity_type="PASSWORD_RESET_RATE_LIMIT_HIT",
            message="Password reset rate limited",
            payload={
                "target_user_id": user.id,
                "target_email": user.email,
                "ip": get_client_ip(request),
                "count": reset_limit.count,
                "limit": reset_limit.limit,
                "retry_after_seconds": reset_limit.retry_after_seconds,
            },
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RATE_LIMITED", "message": "Too many password reset attempts"},
        )

    # Admins and HR can reset directly. Others must request approval.
    if rbac.user_has_any_role(current_user, {Role.ADMIN, Role.HR}):
        user.hashed_password = get_password_hash(payload.password)
        user.updated_at = datetime.now(timezone.utc)
        db.add(user)
        db.commit()
        db.refresh(user)
        return UserRead.model_validate(user)

    approval = Approval(
        entity_type=ApprovalEntityType.USER,
        entity_id=user_id,
        action_type=ApprovalActionType.RESET_PASSWORD,
        requester_user_id=current_user.id,
        approver_user_id=None,
        status=ApprovalStatus.PENDING,
        reason="Password reset requested",
        payload_json={"password": payload.password},
    )
    allowed_roles = required_roles_for_approval(approval.entity_type, approval.action_type)
    request_approval(db, approval=approval, allowed_roles=allowed_roles, auto_assign=False)
    notify_roles(
        db,
        roles=allowed_roles,
        notif_type=NotificationType.APPROVAL_PENDING,
        message=f"Approval requested: {approval.action_type}",
        payload={"approval_id": approval.id, "user_id": user_id},
        exclude_user_ids=[current_user.id],
    )
    db.commit()
    db.refresh(approval)
    return ApprovalRead.model_validate(approval)


@router.post("/{user_id}/reset-mfa", response_model=ApprovalRead)
def reset_user_mfa(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ApprovalRead:
    """Admin endpoint to reset a user's MFA (TOTP + backup codes).

    Creates an approval request that, when approved, clears the user's
    totp_secret, totp_enabled, and backup_codes_hash fields.
    """
    _require_manage_users(current_user)
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if not user.totp_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User does not have MFA enabled")

    approval = Approval(
        entity_type=ApprovalEntityType.USER,
        entity_id=user_id,
        action_type=ApprovalActionType.RESET_MFA,
        requester_user_id=current_user.id,
        approver_user_id=None,
        status=ApprovalStatus.PENDING,
        reason=f"MFA reset requested for user {user.email}",
    )
    allowed_roles = required_roles_for_approval(approval.entity_type, approval.action_type)
    request_approval(db, approval=approval, allowed_roles=allowed_roles, auto_assign=False)
    notify_roles(
        db,
        roles=allowed_roles,
        notif_type=NotificationType.APPROVAL_PENDING,
        message=f"MFA reset approval requested for {user.email}",
        payload={"approval_id": approval.id, "user_id": user_id},
        exclude_user_ids=[current_user.id],
    )
    db.commit()
    db.refresh(approval)
    return ApprovalRead.model_validate(approval)
