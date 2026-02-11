# ZenOps v2 Implementation Log

Last updated: 2026-02-11

## Scope Completed

### 1) Foundation Scaffold (Monorepo + Apps + Packages)
- Built Turborepo + pnpm monorepo structure.
- Apps created:
  - `apps/api` (NestJS + Fastify)
  - `apps/worker` (BullMQ)
  - `apps/web`
  - `apps/studio`
  - `apps/portal`
- Shared packages created:
  - `packages/db`, `packages/auth`, `packages/contracts`, `packages/common`, `packages/rls`, `packages/config`, `packages/ui`
- Infra added:
  - `infra/docker/compose.dev.yml`
  - `infra/docker/compose.prod.yml`
  - `infra/sql/001_init.sql`
  - `infra/sql/010_rls.sql`
  - `infra/sql/020_seed.sql`

### 2) Database + RLS + Prisma
- Prisma multi-file schema implemented in `packages/db/prisma/schema`.
- Pinned Prisma versions to exact patch:
  - `prisma@6.19.2`
  - `@prisma/client@6.19.2`
- Added dedicated DB roles (no shared PUBLIC policy model):
  - `zen_web`, `zen_studio`, `zen_portal`, `zen_worker`
- Implemented helper SQL functions:
  - `app.current_tenant_id()`
  - `app.current_user_id()`
- Enforced role-scoped RLS policies and default-deny behavior.
- Preserved dedicated external lane model (`TENANT_EXTERNAL_UUID`) and portal-user isolation.
- Kept `BYPASSRLS` out of the design.

### 3) API + Worker Workflow Spine
- API implemented with `/v1` prefix and key endpoints:
  - `/v1/health`
  - `/v1/auth/login`
  - CRUD skeletons for tenants/users/work_orders/assignments/report_requests
  - `POST /v1/report-requests/:id/queue-draft`
  - `POST /v1/report-requests/:id/finalize`
  - `GET /v1/report-jobs`
- Transaction-scoped tenant context implemented with `set_config` calls per request.
- Worker queue configured (`report-generation`) with retries/backoff/retention defaults.
- Implemented deterministic `jobId=report_job.id` behavior.
- Credits flow scaffolded with reserve/consume/release and idempotent semantics.

### 4) Frontend Surfaces
- `web`: tenant/internal queue dashboard.
- `studio`: read-focused control-plane diagnostics.
- `portal`: external commission intake flow (with portal lane behavior).

### 5) Single-Tenant Launch Gating (Latest Requirement)
Implemented without changing architecture:

- Added flags:
  - `ZENOPS_MULTI_TENANT_ENABLED` (default `false`)
  - `ZENOPS_INTERNAL_TENANT_ID`
  - `ZENOPS_EXTERNAL_TENANT_ID`
- API gating in single-tenant mode:
  - Blocks tenant creation endpoints with `403 MULTI_TENANT_DISABLED`.
  - Rejects non-internal `aud=web` tenant tokens early with `403 TENANT_NOT_ENABLED`.
  - Forces `aud=portal` tenant context to external tenant lane.
- RequestContext enforcement:
  - Keeps transaction-scoped `app.tenant_id`, `app.user_id`, `app.aud`.
  - Forces internal tenant for `aud=web` in single-tenant mode.
- Seeding updated for launch mode:
  - Seeds only internal + external tenants.
  - Adds internal admin user + studio admin user.
- Frontend gating:
  - Web does not expose tenant switch/onboarding by default.
  - Studio and portal remain enabled.
- Prod compose:
  - Launches only core services by default: postgres, redis, api, worker, web, studio, portal.

### 6) Object Storage + Document Registry + Report Data Bundle
- Added storage abstraction package: `packages/storage`
  - `StorageProvider` interface
  - `S3CompatibleProvider` (AWS SDK; works with S3/R2/MinIO style endpoints)
  - `LocalDiskProvider` fallback for local/dev
  - deterministic storage key helper
- Added storage env/config surface:
  - `.env.example` now includes `STORAGE_DRIVER`, `S3_*` vars
  - `packages/config` env schema extended accordingly
  - API provider wiring in `apps/api/src/app.module.ts`
- Extended Prisma schema with new enums/models:
  - `documents`, `document_links`
  - `document_tag_keys`, `document_tag_values`, `document_tag_map`
  - `input_schemas`, `report_inputs`, `extraction_runs`
  - Added new schema file: `packages/db/prisma/schema/070_documents_inputs.prisma`
- Applied new role-scoped RLS policies in `infra/sql/010_rls.sql`:
  - Enabled+forced RLS for document and report-input tables
  - Added tenant web policies, studio read policies, worker policies
  - Added portal document isolation policies (external lane + portal user ownership/link checks)
  - Added document-link target check constraint + tag-map partial unique index
- Added API contract schemas (`packages/contracts`) for:
  - file presign upload/download + confirm
  - document metadata patch + tags upsert + listing query
  - report data-bundle patch payload/schema version controls
- Added API endpoints and service logic:
  - `POST /v1/files/presign-upload`
  - `POST /v1/files/confirm-upload`
  - `GET /v1/files/:id/presign-download`
  - `PATCH /v1/documents/:id/metadata`
  - `POST /v1/documents/:id/tags`
  - `GET /v1/documents`
  - `GET /v1/report-requests/:id/data-bundle`
  - `PATCH /v1/report-requests/:id/data-bundle`
- Worker hook updated:
  - queue-draft processing now loads report input + linked document metadata spine before placeholder artifact write
  - generation pipeline behavior remains deterministic/idempotent
- Frontend launch-gating polish:
  - portal tenant lane input now fixed/disabled to external lane UUID display (still API-enforced)
- Turborepo task dependency improvement:
  - `lint` now depends on `^build` to prevent stale cross-package type surfaces during monorepo checks
- OpenAPI path catalog extended to include new endpoints.
- Runtime compatibility fixes made during validation:
  - Added `@fastify/static` dependency required by Fastify Swagger setup.
  - Fixed Fastify middleware compatibility in request-id middleware (`setHeader` on raw response).
  - Fixed DB bootstrap script for current Prisma CLI behavior:
    - `db execute` now uses `--url` only (no `--schema`).
    - SQL file and schema paths resolved to absolute paths.
    - `db push` now runs with root DB URL for required DDL privileges.
  - Fixed Postgres 18 compose volume mount target to `/var/lib/postgresql`.
  - Added host-port override env support in compose files:
    - `POSTGRES_BIND_PORT`, `REDIS_BIND_PORT`
    - `API_BIND_PORT`, `WEB_BIND_PORT`, `STUDIO_BIND_PORT`, `PORTAL_BIND_PORT`
  - Added `CI=true` in dev compose Node services to avoid interactive `pnpm install` prompts.
  - Fixed seeding for `roles` table by inserting explicit UUID ids via `gen_random_uuid()`.

### 7) Test Additions
- API unit tests:
  - single-tenant rejection for non-internal web tenant in presign upload
  - link consistency enforcement for upload linkage
  - data-bundle optimistic schema version mismatch handling
- DB integration fixtures/tests extended for documents:
  - portal user A cannot read portal user B documents
  - tenant isolation checks for document visibility
  - existing RLS tests remain environment-aware/skippable when DB vars are absent

### 8) Smoke Validation Run (Detailed)
Date: 2026-02-11

Run strategy:
- Started infra with compose on alternate host ports to avoid collisions:
  - `POSTGRES_BIND_PORT=55432`
  - `REDIS_BIND_PORT=56379`
- Bootstrapped DB using:
  - `DATABASE_URL_ROOT=postgresql://postgres:postgres@localhost:55432/zenops`
  - `DATABASE_URL=postgresql://zen_api:zen_api@localhost:55432/zenops`
  - `pnpm node scripts/bootstrap-db.mjs`
- Started API locally on:
  - `API_PORT=3300`
- Verified endpoint flow with a web token under internal tenant.

Smoke checks executed and passed:
- `GET /v1/health` -> 200 `{ ok: true }`
- `POST /v1/auth/login` (`aud=web`, internal tenant) -> 200 token issued
- `POST /v1/report-requests` -> report request created
- `PATCH /v1/report-requests/:id/data-bundle` -> payload/schema stored
- `POST /v1/files/presign-upload` -> document + storage key returned
- `POST /v1/files/confirm-upload` -> status transitioned to uploaded + link persisted
- `POST /v1/documents/:id/tags` -> tags upserted
- `PATCH /v1/documents/:id/metadata` -> metadata merged
- `GET /v1/documents?report_request_id=...` -> 1 row returned
- `GET /v1/documents?tag_key=doc_type&tag_value=title-deed` -> 1 row returned
- `GET /v1/files/:id/presign-download` -> presigned/local URL returned
- `GET /v1/report-requests/:id/data-bundle` -> payload + linked document included
- Single-tenant gate check:
  - `POST /v1/auth/login` with non-internal web tenant -> `403 TENANT_NOT_ENABLED`

### 9) Dev Workflow Hardening (Docker Coexistence + Node Module Isolation)
- Added infra-only compose mode: `infra/docker/compose.infra.yml` with only `postgres` and `redis`.
- Infra host ports are parameterized for side-by-side stacks:
  - `POSTGRES_BIND_PORT` (default `55432`)
  - `REDIS_BIND_PORT` (default `56379`)
- Root scripts added/verified:
  - `pnpm infra:up`
  - `pnpm infra:down`
  - `pnpm dev:local` (infra up -> bootstrap db -> run api/web/studio/portal locally)
- Removed hard-coded `container_name` entries from dev and infra compose files to avoid cross-project name collisions.
- Added default compose project scoping in root scripts:
  - `COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-zenopsv2-infra}` for infra
  - `COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-zenopsv2}` for dev
- Kept container-dev safe from host corruption:
  - bind-mount repo source
  - named volumes for `/app/node_modules` per Node service
  - Linux container installs no longer overwrite host macOS binaries in `node_modules`.

Smoke verification for Zen v1 coexistence (2026-02-11):
- `COMPOSE_PROJECT_NAME=zenopsv2workaround POSTGRES_BIND_PORT=65432 REDIS_BIND_PORT=65379 pnpm infra:up` -> success
- `DATABASE_URL_ROOT=postgresql://postgres:postgres@localhost:65432/zenops DATABASE_URL=postgresql://postgres:postgres@localhost:65432/zenops pnpm bootstrap:db` -> success
- Local API started with:
  - `API_PORT=3300`
  - `DATABASE_URL_API=postgresql://zen_api:zen_api@localhost:65432/zenops`
  - `DATABASE_URL_WORKER=postgresql://zen_worker:zen_worker@localhost:65432/zenops`
  - `REDIS_URL=redis://localhost:65379`
  - `ARTIFACTS_DIR=/tmp/zenops-artifacts`
- `curl http://localhost:3300/v1/health` -> `{"ok":true,"service":"zenops-api",...}`
- `COMPOSE_PROJECT_NAME=zenopsv2workaround pnpm infra:down` -> success

## Verification Status
Executed and passing:
- `pnpm build`
- `pnpm lint`
- `pnpm test`
- `pnpm contract_check` (passes with updated `apps/api/openapi.json` in working tree)
- End-to-end smoke flow for storage/docs/data-bundle on local API + compose infra

Notes:
- RLS integration tests are present and environment-aware; they skip when DB test env vars are not provided.

## Git History (Key)
- `e07afad` - `chore: scaffold v2 foundation`
- `0449e5e` - `chore: remove generated vite config artifacts`
- `8a9d029` - `feat: add single-tenant launch gating controls`
