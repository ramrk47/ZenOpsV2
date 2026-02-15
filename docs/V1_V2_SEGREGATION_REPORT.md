# V1/V2 Segregation Report

## Scope
This report defines a clean operating boundary between:
- V1 repo: `/Users/dr.156/zen-ops`
- V2 repo: `/Users/dr.156/ZenOpsV2`

Goal: run both systems in parallel without routing ambiguity, port confusion, or database cross-contamination.

## V1 Snapshot (Legacy Ops App)
## Stack
- Backend: Python FastAPI (`backend/app/main.py`)
- Frontend: React + Vite (`frontend`)
- Data: PostgreSQL via SQLAlchemy/Alembic

## Runtime shape
- API defaults to `uvicorn app.main:app --reload` (commonly `localhost:8000`)
- Core routes historically under `/api/*`
- Health endpoints include `/healthz`, `/readyz`, `/version`
- New identity endpoint added: `/v1/meta` returning `app=zenops-v1`

## Functional role
- Legacy internal operations and existing tested workflows
- Existing staff-facing behavior remains here until explicitly replaced

## V2 Snapshot (Alpha Platform)
## Stack
- API: NestJS + Fastify (`apps/api`)
- Worker: BullMQ (`apps/worker`)
- Frontends: `apps/web`, `apps/studio`, `apps/portal`
- Data: PostgreSQL + Prisma multi-file schema + RLS

## Runtime shape
- API prefix `/v1/*`
- RLS tenant-scoped request context via transaction `set_config`
- M4.6 delivered assignment lifecycle, tasks, channels, master-data intake, analytics resilience
- New identity endpoint added: `/v1/meta` returning `app=zenops-v2`

## Functional role
- Alpha platform for new control/data plane architecture
- Primary path for new milestone work and migration targets

## Overlap and Conflict Inventory
## Entity naming overlap
- Both systems model assignments, tasks, users/people, documents, notifications, payroll.
- Similar business terms exist, but schema and lifecycle behavior differ.

## Endpoint naming overlap
- Both systems expose health and assignment-like endpoints.
- V1 historically uses `/api/*`; V2 uses `/v1/*`.
- Without identity probing, plain host/port checks can be misleading.

## Env var overlap
- Shared generic names can collide when both are started in one shell:
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `API_PORT` / frontend port vars
- Required mitigation: keep per-repo `.env` files separate and use explicit exported prefixes in orchestration scripts.

## Port overlap
- Both systems can bind common local ports (`3000`, `5173`, etc.).
- Resolved by:
  1. explicit `/v1/meta` identity in both APIs
  2. `scripts/detect-zenops-ports.sh` in V2 for deterministic mapping

## Base URL convention
- V2 automation/scripts:
  - `ZENOPS_V2_API_BASE_URL=http://127.0.0.1:<port>/v1`
- V1 automation/scripts:
  - `ZENOPS_V1_API_BASE_URL=http://127.0.0.1:<port>/v1` (or `/api` where legacy routes are consumed)

## Non-Negotiable Separation Rules
1. V1 runs as legacy ops app; V2 runs as alpha platform.
2. No shared database writes between V1 and V2.
3. No direct DB coupling from V2 Studio to V2 data plane services (API-only boundary).
4. Do not reuse ambiguous localhost ports without `/v1/meta` validation.
5. Any migration from V1 to V2 is explicit and reversible.

## Strangler Migration Outline
1. Keep V1 as source-of-truth for still-unmigrated flows.
2. Build/validate equivalent capability in V2 (small slices).
3. Add adapter-level routing from entrypoints to V2 for migrated slices.
4. Freeze V1 writes for migrated slices once parity is proven.
5. Decommission V1 endpoints module-by-module.

This follows the Strangler Fig approach: route new/selected flows to the new system while legacy remains intact until replaced.

## Current Tooling Added for Segregation
- V2: `/v1/meta` + control namespace reservations (`/v1/control/*`)
- V1: `/v1/meta`
- V2 script: `scripts/detect-zenops-ports.sh`
- V2 demo scripts now support `ZENOPS_V2_API_BASE_URL` with V2 identity validation
