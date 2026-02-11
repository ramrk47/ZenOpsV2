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
- `pnpm dev`
- `pnpm dev:down`
- `pnpm reset`

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
