# ADR-0001: Multi-Role User Model + Capability Union + Partner Single-Role

## Status
Accepted

## Context
The system originally enforced a single role per user (`users.role` enum column). This made it impossible for one person to act in multiple capacities — for example, a small-team member who handles both HR and Finance tasks. At the same time, External Partners (outsourcing clients) were being introduced and needed strict isolation from internal roles and routes.

The RBAC system already mapped each role to a dictionary of boolean capabilities (`rbac.py` → `ROLE_CAPABILITIES`), so multi-role support required a way to merge capabilities across roles without breaking existing API contracts, JWT tokens, or frontend role guards.

Key pressures:
- Real org structures have people wearing multiple hats (HR + Finance, OPS_MANAGER + ADMIN).
- External partners must never access internal assignment workspaces, chat, tasks, or timelines.
- Frontend and mobile clients already depend on a single `role` field in auth tokens.
- Individual users sometimes need capability overrides (e.g., grant an EMPLOYEE one specific capability without promoting them).

## Decision
1. **Dual-column model**: Add `users.roles` (JSONB array) alongside the existing `users.role` (enum). The primary role remains for display, legacy queries, and backward-compatible API responses. The roles array is the source of truth for capability computation.
2. **Capability union**: Compute user capabilities as the boolean OR across all assigned roles, then apply per-user `capability_overrides` (JSONB). A capability is granted if *any* role grants it, unless an override explicitly revokes it (`override = false`). Implemented via `get_capabilities_for_roles()` in `rbac.py`.
3. **Partner single-role enforcement**: `EXTERNAL_PARTNER` cannot be combined with any other role. Enforced at user registration (`auth.py`) and role update endpoints. Partner users are denied all non-partner paths at the dependency level (`deps.py` → checks path prefix against `/api/partner` whitelist).
4. **Token inclusion**: JWT tokens include both `role` (string) and `roles` (list of strings). Clients that only read `role` continue to work; multi-role-aware clients read `roles`.
5. **Migration strategy**: Migration `0017_add_user_roles` adds the JSONB column and backfills existing users with `roles = [role.value]`, ensuring no data gap.

## Consequences
- **RBAC queries must use helpers**: Direct `WHERE role = X` misses multi-role users. ORM helper `User.has_role(role)` checks both columns via `or_(cls.role == role, cls.roles.contains([role.value]))`.
- **Capability model is permissive**: Union (OR) means the most permissive role wins. There is no "deny" role — restriction is only possible via `capability_overrides`. This is intentional for a small-team product but would need rethinking at scale.
- **Token refresh gap**: Role changes in the database do not take effect until the user logs in again (no token refresh or revocation mechanism). Acceptable at current scale; would need a token blocklist or short-lived tokens for stricter environments.
- **Frontend role selectors**: User management UI needs multi-select with a "primary role" chooser. The primary role drives layout selection (AdminLayout vs EmployeeLayout vs PartnerLayout).
- **Partner isolation is path-based**: Partner security relies on `deps.py` checking the request path prefix, plus `partner_id` ownership checks on every partner endpoint. No internal endpoints are reused for partner UX.

## Alternatives Considered
- **Replace `role` entirely with `roles` array**: Rejected because the frontend, seed scripts, and multiple backend queries reference `user.role` directly. A full migration would touch too many files for marginal benefit.
- **Join table (`user_roles`)**: Rejected for simplicity at current scale (~100 users). A JSONB array is queryable via `contains()`, avoids extra joins, and is easier to backfill. Would reconsider if role membership becomes dynamic or audited.
- **Hierarchical roles (ADMIN > OPS_MANAGER > EMPLOYEE)**: Rejected because the role graph is not strictly hierarchical — HR and Finance are parallel, not nested. Capability union is more flexible.

## Key Files
- `backend/app/models/user.py` — User model with `role`, `roles`, `capability_overrides`
- `backend/app/core/rbac.py` — `ROLE_CAPABILITIES`, `roles_for_user()`, `get_capabilities_for_roles()`
- `backend/app/core/deps.py` — `get_current_user()` with partner path enforcement
- `backend/app/routers/auth.py` — token creation with `role` + `roles`, partner single-role guard
- `backend/alembic/versions/0017_add_user_roles.py` — migration + backfill
