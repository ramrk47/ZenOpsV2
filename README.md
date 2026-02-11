# ZenOps v2 Scaffold

ZenOps v2 foundation scaffold as a Turborepo + pnpm monorepo.

## Stack
- NestJS + Fastify API
- PostgreSQL 18 + Prisma multi-file schema
- Redis + BullMQ worker
- React + Vite frontends (`web`, `studio`, `portal`)
- Postgres RLS with transaction-scoped `set_config`

## Structure
- `apps/api`: core backend API (`/v1`)
- `apps/worker`: report generation worker
- `apps/web`: tenant and internal ops
- `apps/studio`: control plane (aud=`studio`)
- `apps/portal`: external commission portal
- `packages/*`: shared contracts/auth/db/common/ui/config/rls
- `infra/docker`: compose files
- `infra/sql`: DB bootstrap + RLS + seed

## Commands
- `pnpm install`
- `pnpm build`
- `pnpm lint`
- `pnpm test`
- `pnpm contract_check`
- `pnpm infra:up`
- `pnpm infra:down`
- `pnpm bootstrap:db`
- `pnpm dev:local`
- `pnpm dev`
- `pnpm dev:down`
- `pnpm reset`

## 5-Minute Demo
- Reset a clean local demo state:
  - `./scripts/reset-demo.sh`
- Run the assignment spine API demo:
  - `./scripts/demo.sh`
- Run the billable-finalize idempotency demo:
  - `./scripts/demo-billing.sh`
- Expected outcome:
  - PASS summary with `tasks=1`, `messages=1`, `documents=1`, `activities>=4`.
  - PASS summary from billing demo with `usage_events=1`, `invoice_lines=1`, stable total after retry.
- Optional flags:
  - `DEMO_ASSUME_INFRA_RUNNING=1 ./scripts/demo.sh` (skip infra startup)
  - `DEMO_ASSUME_API_RUNNING=1 ./scripts/demo.sh` (skip API startup)
  - Same flags apply to `./scripts/demo-billing.sh`.
  - `DEMO_FORCE_RESET=0 ./scripts/demo-billing.sh` (do not call `reset-demo.sh` first)

## Local Dev Notes
- `infra:up` starts only Postgres + Redis.
- `dev:local` runs app services on the host to avoid host/container `node_modules` cross-platform corruption.
- Compose scripts support project and port overrides for running alongside Zen v1:
  - `COMPOSE_PROJECT_NAME=zenopsv2workaround`
  - `POSTGRES_BIND_PORT=65432`
  - `REDIS_BIND_PORT=65379`

## Launch Gating
- `ZENOPS_MULTI_TENANT_ENABLED=false` by default.
- In single-tenant mode, `aud=web` is restricted to `ZENOPS_INTERNAL_TENANT_ID`.
- `aud=portal` is always forced to `ZENOPS_EXTERNAL_TENANT_ID`.
- Tenant creation APIs return `403 MULTI_TENANT_DISABLED` until multi-tenant mode is enabled.

## Security Model
- Dedicated DB roles: `zen_web`, `zen_studio`, `zen_portal`, `zen_worker`
- `FORCE ROW LEVEL SECURITY` on tenant-owned tables
- Per-request transaction wrapper sets:
  - `app.tenant_id`
  - `app.user_id`
  - `app.aud`
- Safe SQL helpers:
  - `app.current_tenant_id()`
  - `app.current_user_id()`
- No `BYPASSRLS`

## Notes
This is a foundation scaffold with minimal business logic and clear extension points.

## Staging Deploy Notes (Hostinger VPS + Traefik)
- DNS/subdomains:
  - `v2.<your-domain>` -> web
  - `api-v2.<your-domain>` -> API
  - `portal.<your-domain>` -> portal (optional)
- Networking:
  - Only Traefik binds host ports `80/443`.
  - API/web/portal should be attached to an internal Docker network and exposed to Traefik by labels, not host `ports`.
- Staging protection:
  - Add Traefik BasicAuth middleware (or IP allowlist) on all staging routers.
  - Keep studio/internal routes protected behind auth and capability checks.
- Runtime components:
  - Keep API + worker + infra services enabled.
  - Keep `ZENOPS_MULTI_TENANT_ENABLED=false` for internal-only launch mode.

## CI Notes
- `/Users/dr.156/ZenOpsV2/.github/workflows/rls-integration.yml` runs DB RLS integration tests on every PR/push to `main` using ephemeral Postgres + Redis and seeded role-based URLs (`zen_web`, `zen_portal`).
