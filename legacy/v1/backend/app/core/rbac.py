from __future__ import annotations

from typing import Dict, Iterable, Mapping, Optional, Tuple

from fastapi import HTTPException, status

from app.models.enums import Role


ROLE_CAPABILITIES: dict[Role, Dict[str, bool]] = {
    Role.ADMIN: {
        "view_all_assignments": True,
        "create_assignment": True,
        "modify_money": True,
        "reassign": True,
        "view_users": True,
        "manage_users": True,
        "view_invoices": True,
        "create_invoice": True,
        "modify_invoice": True,
        "manage_master_data": True,
        "manage_company_accounts": True,
        "approve_actions": True,
        "delete_assignment_direct": True,
        "view_analytics": True,
        "partner_portal_access": False,
        "view_payroll": True,
        "create_payroll_run": True,
        "manage_payroll": True,
    },
    Role.OPS_MANAGER: {
        "view_all_assignments": True,
        "create_assignment": True,
        "modify_money": False,
        "reassign": True,
        "view_users": True,
        "manage_users": False,
        "view_invoices": True,
        "create_invoice": True,
        "modify_invoice": False,
        "manage_master_data": True,
        "manage_company_accounts": False,
        "approve_actions": True,
        "delete_assignment_direct": False,
        "view_analytics": True,
        "partner_portal_access": False,
        "view_payroll": False,
        "create_payroll_run": False,
        "manage_payroll": False,
    },
    Role.HR: {
        "view_all_assignments": True,
        "create_assignment": False,
        "modify_money": False,
        "reassign": True,
        "view_users": True,
        "manage_users": True,
        "view_invoices": False,
        "create_invoice": False,
        "modify_invoice": False,
        "manage_master_data": True,
        "manage_company_accounts": False,
        "approve_actions": True,
        "delete_assignment_direct": False,
        "view_analytics": False,
        "partner_portal_access": False,
        "view_payroll": True,
        "create_payroll_run": False,
        "manage_payroll": False,
    },
    Role.FINANCE: {
        "view_all_assignments": True,
        "create_assignment": False,
        "modify_money": True,
        "reassign": False,
        "view_users": True,
        "manage_users": False,
        "view_invoices": True,
        "create_invoice": True,
        "modify_invoice": True,
        "manage_master_data": False,
        "manage_company_accounts": True,
        "approve_actions": True,
        "delete_assignment_direct": False,
        "view_analytics": False,
        "partner_portal_access": False,
        "view_payroll": True,
        "create_payroll_run": True,
        "manage_payroll": True,
    },
    Role.ASSISTANT_VALUER: {
        "view_all_assignments": False,
        "create_assignment": True,
        "modify_money": False,
        "reassign": False,
        "view_users": False,
        "manage_users": False,
        "view_invoices": False,
        "create_invoice": False,
        "modify_invoice": False,
        "manage_master_data": False,
        "manage_company_accounts": False,
        "approve_actions": False,
        "delete_assignment_direct": False,
        "view_analytics": False,
        "partner_portal_access": False,
        "view_payroll": False,
        "create_payroll_run": False,
        "manage_payroll": False,
    },
    Role.FIELD_VALUER: {
        "view_all_assignments": False,
        "create_assignment": False,
        "modify_money": False,
        "reassign": False,
        "view_users": False,
        "manage_users": False,
        "view_invoices": False,
        "create_invoice": False,
        "modify_invoice": False,
        "manage_master_data": False,
        "manage_company_accounts": False,
        "approve_actions": False,
        "delete_assignment_direct": False,
        "view_analytics": False,
        "partner_portal_access": False,
        "view_payroll": False,
        "create_payroll_run": False,
        "manage_payroll": False,
    },
    Role.EMPLOYEE: {
        "view_all_assignments": False,
        "create_assignment": False,
        "modify_money": False,
        "reassign": False,
        "view_users": False,
        "manage_users": False,
        "view_invoices": False,
        "create_invoice": False,
        "modify_invoice": False,
        "manage_master_data": False,
        "manage_company_accounts": False,
        "approve_actions": False,
        "delete_assignment_direct": False,
        "view_analytics": False,
        "partner_portal_access": False,
        "view_payroll": False,
        "create_payroll_run": False,
        "manage_payroll": False,
    },
    Role.EXTERNAL_PARTNER: {
        "view_all_assignments": False,
        "create_assignment": False,
        "modify_money": False,
        "reassign": False,
        "view_users": False,
        "manage_users": False,
        "view_invoices": False,
        "create_invoice": False,
        "modify_invoice": False,
        "manage_master_data": False,
        "manage_company_accounts": False,
        "approve_actions": False,
        "delete_assignment_direct": False,
        "view_analytics": False,
        "partner_portal_access": True,
        "view_payroll": False,
        "create_payroll_run": False,
        "manage_payroll": False,
    },
}


def merge_capabilities(
    base: Mapping[str, bool],
    overrides: Optional[Mapping[str, Optional[bool]]] = None,
) -> Dict[str, bool]:
    merged = dict(base)
    if not overrides:
        return merged
    for key, value in overrides.items():
        if key not in merged:
            continue
        if value is None:
            continue
        merged[key] = bool(value)
    return merged


def _coerce_role(value: Role | str | None) -> Optional[Role]:
    if value is None:
        return None
    if isinstance(value, Role):
        return value
    try:
        return Role(str(value))
    except Exception:
        return None


def roles_for_user(user) -> list[Role]:
    roles: list[Role] = []
    raw_roles = getattr(user, "roles", None)
    if raw_roles:
        for raw in raw_roles:
            role = _coerce_role(raw)
            if role and role not in roles:
                roles.append(role)
    primary = _coerce_role(getattr(user, "role", None))
    if primary and primary not in roles:
        roles.insert(0, primary)
    if not roles and primary:
        roles = [primary]
    return roles


def normalize_roles_input(
    role: Optional[Role],
    roles: Optional[Iterable[Role]],
    *,
    default_role: Role = Role.EMPLOYEE,
) -> Tuple[Role, list[Role]]:
    normalized: list[Role] = []
    if roles:
        for value in roles:
            coerced = _coerce_role(value)
            if coerced and coerced not in normalized:
                normalized.append(coerced)
    primary = _coerce_role(role) or (normalized[0] if normalized else default_role)
    if primary not in normalized:
        normalized.insert(0, primary)
    return primary, normalized


def _roles_from_input(role_or_roles) -> list[Role]:
    if isinstance(role_or_roles, Role):
        return [role_or_roles]
    if isinstance(role_or_roles, (list, tuple, set)):
        roles: list[Role] = []
        for value in role_or_roles:
            role = _coerce_role(value)
            if role and role not in roles:
                roles.append(role)
        return roles
    return roles_for_user(role_or_roles)


def get_capabilities_for_roles(
    roles: Iterable[Role],
    overrides: Optional[Mapping[str, Optional[bool]]] = None,
) -> Dict[str, bool]:
    merged: Dict[str, bool] = {}
    for role in roles:
        base = ROLE_CAPABILITIES.get(role, {})
        for key, value in base.items():
            merged[key] = merged.get(key, False) or bool(value)
    return merge_capabilities(merged, overrides)


def get_capabilities(role: Role, overrides: Optional[Mapping[str, Optional[bool]]] = None) -> Dict[str, bool]:
    return get_capabilities_for_roles([role], overrides)


def get_capabilities_for_user(user) -> Dict[str, bool]:
    overrides = getattr(user, "capability_overrides", None)
    roles = roles_for_user(user)
    return get_capabilities_for_roles(roles, overrides)


def user_has_role(user, role: Role) -> bool:
    return role in roles_for_user(user)


def user_has_any_role(user, roles: Iterable[Role]) -> bool:
    user_roles = set(roles_for_user(user))
    return any(role in user_roles for role in roles)


def require_roles(user, required_roles: Iterable[Role]) -> None:
    """
    Require that the user has at least one of the specified roles.
    Raises HTTPException with 403 status if user doesn't have required roles.
    """
    if not user_has_any_role(user, required_roles):
        role_names = ", ".join(role.value for role in required_roles)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied. Required roles: {role_names}"
        )


def can_view_all(role_or_roles) -> bool:
    roles = _roles_from_input(role_or_roles)
    return get_capabilities_for_roles(roles).get("view_all_assignments", False)


def can_modify_money(role_or_roles) -> bool:
    roles = _roles_from_input(role_or_roles)
    return get_capabilities_for_roles(roles).get("modify_money", False)


def can_reassign(role_or_roles) -> bool:
    roles = _roles_from_input(role_or_roles)
    return get_capabilities_for_roles(roles).get("reassign", False)


def can_manage_users(role_or_roles) -> bool:
    roles = _roles_from_input(role_or_roles)
    return get_capabilities_for_roles(roles).get("manage_users", False)


def can_manage_master(role_or_roles) -> bool:
    roles = _roles_from_input(role_or_roles)
    return get_capabilities_for_roles(roles).get("manage_master_data", False)


def can_manage_company_accounts(role_or_roles) -> bool:
    roles = _roles_from_input(role_or_roles)
    return get_capabilities_for_roles(roles).get("manage_company_accounts", False)


def can_approve(role_or_roles) -> bool:
    roles = _roles_from_input(role_or_roles)
    return get_capabilities_for_roles(roles).get("approve_actions", False)


def can_manage_support(role_or_roles) -> bool:
    """Check if user can manage support threads."""
    roles = _roles_from_input(role_or_roles)
    # Admin, OPS_MANAGER, HR can manage support
    allowed_roles = {Role.ADMIN, Role.OPS_MANAGER, Role.HR}
    return any(role in allowed_roles for role in roles)
