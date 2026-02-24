# ADR-0002: Approval Routing by Entity Type with Self-Approval Guard

## Status
Accepted

## Context
The original approval system allowed any user with an approver-level role to see and act on any pending approval, regardless of what was being approved. This created integrity problems:

- Finance users could approve HR leave requests they had no business reviewing.
- Ops managers could approve invoice payments outside their domain.
- Requesters could approve their own requests (self-approval loophole).
- When no specific approver was assigned, there was no logic to auto-route to the right person.

The system needed deterministic routing so that approvals reach the right roles, with a fallback auto-assignment mechanism and a self-approval guard to prevent conflicts of interest.

## Decision
1. **Static routing table**: Approvals are routed by `entity_type` to a hardcoded list of eligible roles. Defined in `services/approvals.py`:
   - `ASSIGNMENT` → `[OPS_MANAGER, ADMIN]`
   - `LEAVE` → `[HR, ADMIN]`
   - `INVOICE` → `[FINANCE, ADMIN]`
   - `USER` → `[ADMIN]`
   - ADMIN is always eligible as a fallback across all entity types.

2. **Auto-assignment**: When a request is created without a specific `approver_user_id`, the system queries for the first active user matching the allowed roles (ordered by `user.id`). If no eligible user exists, the request is still created but unassigned (will appear in role-filtered inboxes).

3. **Self-approval guard**: A requester cannot approve their own request. One exception: ADMIN users can self-approve ASSIGNMENT-type approvals (pragmatic for small teams where the admin is also the ops lead). Enforced in `routers/approvals.py` at the decide endpoint.

4. **Inbox filtering**: The approval inbox endpoint returns only approvals where the current user is either the assigned approver OR the approval is unassigned AND the user has one of the eligible roles for that entity type. Eligibility is checked via `is_user_eligible_for_approval()`.

5. **Approval templates**: Soft-approval presets are exposed via `GET /api/approvals/templates` — returns a list of common approval action types with human-readable descriptions for the frontend to render as quick-action buttons. This improves discoverability without adding workflow complexity.

6. **Inbox count**: `GET /api/approvals/inbox-count` provides a fast badge count of actionable approvals, used by the sidebar notification bubble.

## Consequences
- **Routing is not configurable per company**: The role-to-entity mapping is hardcoded. A company that wants HR to also approve invoices would need a code change. Acceptable at current scale (single-tenant) but would need a config table for multi-tenant.
- **Auto-assignment is deterministic but arbitrary**: First eligible user by `user.id` gets assigned. There is no round-robin, workload balancing, or preference system. Works for small teams; needs rethinking at scale.
- **No multi-step approval workflows**: Each approval is a single decision point (approve/reject). There is no concept of sequential approvals (e.g., manager then director). Would require a workflow engine if needed later.
- **No SLA or escalation**: There is no timeout on pending approvals and no automatic escalation to a backup approver. The notification sweep generates reminders but does not reassign.
- **Self-approval exception creates asymmetry**: The ADMIN + ASSIGNMENT carve-out is pragmatic but non-obvious. Should be documented in onboarding materials.
- **Eligibility is checked twice**: Once at request creation (validate that an approver exists or can be auto-assigned) and again at inbox query time (filter what the user can see). This is intentional — prevents stale assignments from blocking the inbox.

## Alternatives Considered
- **Configurable routing table in DB**: A `approval_routing_rules` table mapping entity types to roles. Rejected for over-engineering at single-tenant scale — the hardcoded map is easy to audit and change.
- **Approval chains (sequential multi-step)**: Considered for high-value invoices or sensitive operations. Rejected for V1 complexity — can be added later as a wrapper around the current single-step model.
- **No self-approval exception**: Strict "nobody approves their own work" policy. Rejected because in a small team the admin often is the only ops-capable person and blocking them from approving their own assignment changes would halt operations.
- **Queue-based routing (round-robin)**: Distribute approvals evenly across eligible users. Rejected because team sizes are small enough that manual assignment or first-available is sufficient.

## Key Files
- `backend/app/services/approvals.py` — routing table, auto-assignment, eligibility checks, action dispatcher
- `backend/app/routers/approvals.py` — inbox, decide, templates, inbox-count endpoints
- `backend/app/models/enums.py` — `ApprovalEntityType`, `ApprovalActionType`, `ApprovalStatus`
