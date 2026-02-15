# Control Plane Boundaries (Repogen-Ready)

## Purpose
Define a strict control-plane vs data-plane boundary in V2 before report-generation features are introduced.

## Control Plane (Studio)
Control-plane scope is administrative and cross-tenant in nature:
- Tenant registry
- Subscription plan surfaces
- Credit ledger surfaces
- Feature flags / launch controls
- Cross-tenant admin supervision

Reserved API namespace:
- `GET /v1/control/tenant`
- `GET /v1/control/subscriptions`
- `GET /v1/control/credits`

Current behavior for these routes is intentionally `501 Not Implemented` behind RBAC guards to reserve stable URI space now.

## Data Plane (Ops Runtime)
Data-plane scope is tenant-scoped operational execution:
- Assignments and lifecycle transitions
- Tasks and queue-derived signals
- Documents and tags
- Channel requests
- Notifications outbox + worker processing
- Audit/activity streams

## Boundary Rules
1. Studio talks to data-plane through API contracts only.
2. Studio must not read/write data-plane tables directly.
3. Tenant-scoped data access is enforced by DB RLS and request context.
4. Control-plane capabilities are additive; they must not bypass tenant RLS in data-plane flows.

## Security Posture Reference
V2 multi-tenancy enforcement relies on:
- PostgreSQL `ENABLE ROW LEVEL SECURITY`
- tenant-aware `CREATE POLICY` clauses
- transaction-scoped auth context keys (`app.tenant_id`, `app.user_id`, `app.aud`)

This preserves per-tenant isolation as control-plane capabilities expand.

## Repogen Readiness Intent
When report-generation services are introduced:
1. Repogen should consume exported data-plane payloads (API bundles), not raw DB joins.
2. Template/catalog governance belongs to control plane.
3. Assignment evidence + normalized master data remains in data plane.
4. Integrations happen through explicit contracts and queue jobs, not implicit shared-state coupling.
