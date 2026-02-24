# ZenOps v2 Implementation Log

Last updated: 2026-02-24

## Scope Completed

### 0.5) M5.4 Repogen Spine v1 (No DOCX Generation)
- Implemented deterministic Repogen spine in V2 for report prep (no rendering):
  - `repogen_work_orders`
  - `repogen_contract_snapshots`
  - `repogen_evidence_items`
  - `repogen_rules_runs`
  - `repogen_comments`
- Added RLS policies for `repogen_*` tables using `org_id` tenant isolation and portal channel-work-order ownership restrictions.
- Added repogen canonical contract + API zod schemas and OpenAPI path registration for `/v1/repogen/*`.
- Added pure rules engine and readiness evaluator:
  - FMV / realizable / distress calculations
  - co-op adopted/market inversion
  - sqft->sqm standardization
  - co-op round-up-to-next-500 rule
  - template selector metadata + completeness scoring
- Added Repogen V1 API surface:
  - create/list/detail work orders
  - contract patch => immutable input/output snapshots + rules run row + readiness snapshot
  - evidence link metadata + annexure ordering
  - manual comments (justification/enclosures/checklist/notes)
  - status transitions with readiness gating for `READY_FOR_RENDER`
  - deterministic export JSON bundle for future renderer input
- Added billing hooks (without changing existing billing core behavior):
  - acceptance billing on `DATA_PENDING` via billing-control helper
  - planned consumption usage event logging on `READY_FOR_RENDER`
- Added placeholder worker hook:
  - `repogen-compute-snapshot` queue + processor
  - idempotent job id based on `work_order_id:snapshot_version`
- Added minimal operator UI:
  - Studio Repogen list/detail monitor tab
  - Web Repogen production queue page with contract/evidence/manual/status actions
- Added tests for rules, readiness, repogen spine service, worker placeholder, and repogen RLS table isolation.
- Added documentation:
  - `docs/REPOGEN_SPINE_V1.md`

### 0.4) M5.3 Repogen Spine Phase 1 (Assignment Report Packs)
- Implemented assignment-level report-generation foundation (`SBI_UNDER_5CR_V1`) with:
  - upload-first evidence linkage
  - template/version registry usage
  - worker-based placeholder pack/artifact generation
  - auditability and idempotent generation jobs
- Added report generation panel in `apps/web` assignment detail for phase-1 testing.

### 0) M4.7 Billing Spine (Current)
- Added billing control-plane schema/components:
  - accounts, policies, subscriptions/plans
  - credit reservations + immutable ledger
  - usage events ingestion
  - service invoice module (invoices/items/payments/adjustments/attachments/audit/idempotency/sequences)
- Added V2 billing APIs:
  - `/v1/billing/accounts/:accountId/status`
  - `/v1/billing/accounts/status?external_key=...`
  - credit reserve/consume/release
  - billing event ingestion
- Replaced control-plane stubs with functional account/policy/credit/subscription endpoints.
- Extended domain hooks for billing behavior on channel acceptance and deliverables gating checks.
- Added M4.7 docs:
  - `docs/m4.7-dual-vps-launch-readiness.md`
  - `docs/m4.7-smoke-checklist.md`

### 0.1) M4.8 Billing Operator Surfaces (Follow-up)
- Added Studio-operator APIs for credit operations and observability:
  - account-level status read
  - tenant credit aggregate read
  - reservations listing
  - combined billing timeline feed
  - studio-triggered reserve/consume/release actions
- Reworked `apps/studio` into a billing control screen:
  - account selector
  - policy switcher (POSTPAID/CREDIT)
  - wallet/reserved/available cards
  - credit grant and manual reserve actions
  - reservations table with consume/release actions
  - merged billing timeline list

### 0.2) M4.9 Launch Productization (Credits + Service Invoices)
- Credit mutation path hardened with explicit balance row semantics:
  - account/balance row lock on credit writes
  - strict reservation transition rules
  - idempotent reserve/consume/release behavior
  - operator override support for reserve shortfall (tracked via adjustment ledger)
- Added tests covering credit lifecycle and idempotency behavior in:
  - `apps/api/src/billing-control/billing-control.service.test.ts`
- Added temporary VPS control-plane hardening:
  - `STUDIO_ADMIN_TOKEN` fallback auth for `/v1/control/*`
  - control-plane request rate limiting (`CONTROL_RATE_LIMIT_RPM`)
- Added service invoice migration compatibility:
  - `/v1/service-invoices` alias surface
  - mark-paid endpoint + issue idempotency key handling
- Added launch docs and smoke automation:
  - `docs/CREDIT_SYSTEM_RULEBOOK.md`
  - `docs/VPS_DUAL_DEPLOY_RUNBOOK.md`
  - `scripts/smoke-v2.sh`

### 0.3) M5.0 Launchable Billing Workflow Wiring
- Added reconciliation sweep endpoint for operator/cron use:
  - `POST /v1/control/credits/reconcile`
  - scans ACTIVE `channel_request` reservations and resolves:
    - delivered assignments -> consume
    - cancelled/rejected/timed-out/orphaned flows -> release
  - supports `dry_run` mode and bounded `limit`.
- Studio UI now exposes reconciliation actions directly in the Credits tab.
- Web app added a minimal `Invoices` lane:
  - list/filter service invoices
  - create draft
  - issue
  - mark paid
- Portal app now surfaces billing information for commissioned requests:
  - request rows show linked invoice status
  - `My Invoices` section allows payment-proof metadata submission.

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

---

## 10) Milestone Timeline (M4.1 -> M4.5)

### M4.1 (merged and tagged)
- PR: `#1` - `M4.1 hardening: webhook security, idempotency, and notifications demo`
- Merge commit on `main`: `3bd91c5f65d2b579954c7d196e19e44b44e49ff1`
- Tag: `m4.1`
- Outcome:
  - communications spine baseline was stabilized
  - webhook security hardening and dedupe/idempotency foundations were landed

### M4.2 (merged and tagged)
- PR: `#2` - `M4.2: people directory + comms routing`
- Merge commit on `main`: `8be59d29b16dd0203169c5074dd7aba9a356fe93`
- Tag: `m4.2`
- Outcome:
  - people directory + attendance + payroll foundations
  - routing tables for role/team comms assignment
  - first-layer employee/payroll endpoints and UI surface

### M4.3 (merged and tagged)
- PR: `#3` - `M4.3: provider integrations + RBAC hardening`
- Merge commit on `main`: `af8843caf211d8deabf909e3304239df7928c411`
- Tag: `m4.3`
- Outcome:
  - provider-ready worker adapters (Mailgun/Twilio paths)
  - RBAC capability model hardened
  - webhook verification controls extended

### M4.4 (merged and tagged)
- PR: `#4` - `M4.4: mobile docs + manual whatsapp + ops monitor`
- Merge commit on `main`: `2df39c2136b1549cf5df15c007639e9b5c03219f`
- Tag: `m4.4`
- Outcome:
  - mobile document workflow became practical for field operations
  - manual WhatsApp month-1 operational flow landed with auditability
  - studio ops monitor view was added for operational awareness

### M4.5 (merged and tagged)
- PR: `#5` - `M4.5: deploy + ops hardening`
- Merge commit on `main`: `ad46e757180da8cdcf621788567ffff1812fbcfd`
- Tag: `m4.5`
- Outcome:
  - production-like VPS deployment kit added
  - edge auth + routing + backup/restore/downshift operational tooling landed
  - runbook and deploy protocol documented for repeatable operations

---

## 11) Detailed M4.3 Record (Provider Integration + RBAC)

### Branch + commits (ordered)
- Branch: `codex/m4-3-provider-integration`
- Key commit sequence:
  - `0f6849b` - `feat(rls): seed operational roles for m4.3 capability model`
  - `f99f518` - `feat(config): add provider and webhook env flags for notifications`
  - `decc8a4` - `feat(api): enforce capability RBAC and add mailgun webhook route`
  - `1ac0659` - `feat(worker): add mailgun email and twilio whatsapp delivery adapters`
  - `54c63c3` - `test: cover RBAC restrictions webhook status mapping and provider failures`
  - `4397c50` - `chore(docs): add provider demo script and refresh openapi`

### Architecture and behavior changes
- RBAC model formalized around capabilities:
  - `employees.read|write`
  - `attendance.read|write`
  - `payroll.read|write|run`
  - `notifications.routes.read|write`
  - `notifications.send`
  - `invoices.read|write`
- Role mapping used at login/capability expansion:
  - `super_admin`, `ops_manager`, `valuer`, `accounts`, `hr`, `portal_user`
- API guard behavior:
  - role-derived capabilities are enforced by `JwtAuthGuard` + capability decorators
  - protected endpoints reject with explicit missing-capability semantics

### Provider layer changes
- Worker provider adapters:
  - Mailgun email adapter (messages API path)
  - Twilio WhatsApp adapter (messaging API path)
- Safe defaults:
  - NOOP remains default when provider flags/keys are absent
  - missing provider secrets fail safely without crashing core app flow

### Webhook hardening changes
- API routes supported:
  - `/v1/webhooks/sendgrid`
  - `/v1/webhooks/mailgun`
  - `/v1/webhooks/twilio`
  - `/v1/webhooks/twilio/whatsapp`
  - `/v1/webhooks/email` (provider-resolved path)
- Validation control:
  - `WEBHOOKS_ENABLED` default-off gate
  - provider-specific validation flags supported with inheritance from global gate

### Tooling and validation
- Added demo flow:
  - `scripts/demo-providers.sh` (NOOP-first, optional real-provider run when secrets exist)
- Validation run outcomes during milestone:
  - API tests passed
  - worker tests passed
  - contract/openapi drift checks passed once regenerated output was committed

---

## 12) Detailed M4.4 Record (Mobile Docs + Manual WhatsApp + Ops Monitor)

### Branch + commits (ordered)
- Branch: `codex/m4-4-mobile-docs-permissions`
- Commit sequence:
  - `739d13d` - `feat(db): extend document metadata and employee linkability`
  - `ccdc107` - `feat(api): add mobile docs metadata, role routing, and ops monitor endpoints`
  - `1104b4f` - `feat(ui): add mobile upload flow, studio ops monitor, and demo script`

### Database and schema changes
- Enums expanded for operational metadata:
  - `DocumentSource` extended with mobile/desktop ingestion modes:
    - `mobile_camera`, `mobile_gallery`, `desktop_upload`, `email_ingest`, `portal_upload`
  - Added `DocumentClassification`:
    - `bank_kyc`, `site_photo`, `approval_plan`, `tax_receipt`, `legal`, `invoice`, `other`
  - Added `DocumentSensitivity`:
    - `public`, `internal`, `pii`, `confidential`
- `Document` model expanded with:
  - `classification`
  - `sensitivity`
  - `capturedAt`
  - `capturedByEmployeeId`
- `DocumentLink` expanded with:
  - optional `employeeId`
- Index and constraint work:
  - tenant/classification/created index support
  - employee link index support
  - link-target check widened so one of work_order/assignment/report_request/employee must exist

### Contracts/API changes
- Contracts expanded for richer upload and query surfaces:
  - upload body now supports source/classification/sensitivity/captured fields + optional employee link
  - document list query expanded with classification/source/sensitivity/employee filters
- New/updated domain endpoints:
  - `GET /v1/roles/templates`
  - `POST /v1/employees/:id/role`
  - `POST /v1/roles/contact-points`
- Notification admin endpoints added:
  - `POST /v1/notifications/manual-whatsapp`
  - `POST /v1/notifications/outbox/:id/mark-manual-sent`
  - `GET /v1/notifications/ops-monitor`
- Manual WhatsApp flow behavior:
  - create manual outbox card in queued state
  - explicit mark-sent action records attempt metadata and updates status

### UI changes (web + studio)
- Web assignment detail:
  - mobile-friendly upload experience for camera/gallery/file-manager use
  - upload-time tagging metadata
  - status/error states for upload flow
- Studio:
  - read-oriented ops monitor block for outbox/webhook/billing signals
  - manual WhatsApp outbox controls for month-1 operations

### Demo and verification
- Added script:
  - `scripts/demo-mobile-docs.sh`
- Validation executed in milestone:
  - `pnpm --filter @zenops/db prisma:validate`
  - `pnpm --filter @zenops/api lint`
  - `pnpm --filter @zenops/api test`
  - `pnpm --filter @zenops/web lint && build`
  - `pnpm --filter @zenops/studio lint && build`
  - `pnpm --filter @zenops/api contract_check`
- CI/PR gates:
  - required checks (`contract_check`, `rls_integration`) passed before merge

---

## 13) Detailed M4.5 Record (Deploy + Ops Hardening)

### Branch + commits (ordered)
- Branch: `codex/m4-5-deploy-ops-hardening`
- Commit sequence:
  - `35eb0b1` - `feat(infra): add traefik-routed vps compose with basic auth gates`
  - `6593eeb` - `feat(ops): add backup restore and off-hours downshift scripts`
  - `41ccf4e` - `docs: add m4.5 deploy runbook and production checklist`

### New deploy artifacts
- `infra/docker/compose.vps.yml`
  - Traefik edge, TLS resolver wiring, Docker labels for host routing
  - Route map:
    - web host
    - studio host
    - api host
    - portal host
  - BasicAuth middleware scoped to:
    - studio routes
    - api docs
    - optional webhook path hardening
  - internal/edge network separation, healthchecks, restart policy and log bounds
- `.env.prod.example`
  - required production env map:
    - hosts/domains
    - TLS/ACME
    - basic auth env format
    - DB/Redis credentials
    - provider flags + secrets
    - object storage defaults for production mode

### Operational scripts
- `scripts/prod-backup-db.sh`
  - nightly-compatible postgres custom-format backup (`pg_dump -Fc`), gzip + retention pruning
- `scripts/prod-restore-db.sh`
  - restore path with clean/if-exists/no-owner/no-privileges semantics
- `scripts/prod-pre-migrate-backup.sh`
  - backup-first migration guardrail
- `scripts/prod-offhours.sh`
  - worker downshift/upshift/status helper for off-hours cost/load control
- `infra/docker/ops/cron.example`
  - backup and downshift cron templates

### Documentation hardening
- Added runbook:
  - `docs/deploy-runbook-m4.5.md`
  - covers prerequisites, DNS, env setup, first deploy, rollout protocol, backup/restore drill, rollback
- README references updated to include M4.5 assets

### Validation and merge hygiene
- Local validation completed before PR merge:
  - compose config parse with env
  - shell syntax checks on new prod scripts
- CI gates passed before merge:
  - `contract_check`
  - `rls_integration`

---

## 14) Operating Decisions Locked During M4.4/M4.5

- Deployment model:
  - one always-on production-like stack first (no separate staging at current scale)
- Edge protection:
  - one shared BasicAuth password for studio and api docs
  - portal remains externally reachable as designed
- WhatsApp rollout:
  - month-1 manual WhatsApp outbox flow retained
  - Twilio-ready adapter paths preserved for later switch
- Email rollout:
  - Mailgun as first live provider path
- Worker cost policy:
  - no VPS sleep mode
  - off-hours downshift via worker stop/resume

---

## 15) Repository State Notes (Important for Future Sessions)

- There are recurring unrelated local modifications in this workspace that were intentionally not reverted during milestone delivery unless explicitly requested.
- Known examples observed across sessions:
  - `apps/api/package.json`
  - `apps/api/src/common/request-id.middleware.ts`
  - `apps/portal/src/App.tsx`
  - `infra/docker/compose.prod.yml`
  - `turbo.json`
  - `packages/storage/` (untracked in some snapshots)
- Milestone PR work was kept isolated from those files to avoid accidental regression.

---

## 16) Next Recommended Build Track (Post M4.5)

Target next milestone recommendation:
- `M4.6: Bank Standards + Report Readiness + Evidence Pack`

Rationale:
- It unlocks structured report-generation readiness without requiring full template renderer completion.
- It provides immediate operational ROI by reducing missing-data churn and enabling deterministic readiness scoring.

Proposed M4.6 high-value scope:
- bank/report-type standards + required field matrix
- assignment readiness score against selected bank/report type
- evidence pack checklist + exportable assignment data bundle JSON
- tighter field capture discipline for mobile ingestion

---

## 17) Detailed M4.6 Record (Assignment Ops Factory + Master Data Spine)

### Branch + objective context
- Working branch: `codex/m4-6-masterdata-lifecycle`
- Milestone objective: make Workspace operations deterministic with normalized master data, lifecycle state transitions, real task queues, channel intake flow, and idempotent signal recomputation.
- Guardrails followed during implementation:
  - no Postgres volume recreation steps added
  - RLS extended for every new tenant-owned table
  - OpenAPI/contract surfaces updated with endpoint additions
  - user-facing naming retained as `Channel` instead of `Partner`

### DB/Prisma expansion (expand phase)
- New schema files and extensions:
  - `/Users/dr.156/ZenOpsV2/packages/db/prisma/schema/097_ops_factory.prisma`
  - updates in:
    - `/Users/dr.156/ZenOpsV2/packages/db/prisma/schema/010_enums.prisma`
    - `/Users/dr.156/ZenOpsV2/packages/db/prisma/schema/020_identity.prisma`
    - `/Users/dr.156/ZenOpsV2/packages/db/prisma/schema/030_workflow.prisma`
    - `/Users/dr.156/ZenOpsV2/packages/db/prisma/schema/096_master_data_lifecycle.prisma`
- New enums introduced for M4.6 operations:
  - `TaskStatus`: `open`, `done`, `blocked`
  - `TaskPriority`: `low`, `medium`, `high`
  - `ChannelType`: `agent`, `advocate`, `builder`, `other`
  - `CommissionMode`: `percent`, `flat`
  - `ChannelRequestStatus`: `submitted`, `accepted`, `rejected`
- New tables/models:
  - `tasks`
  - `assignment_status_history`
  - `channel_requests`
  - `branch_contacts`
- Assignment model normalization updates:
  - `sourceType`, `channelId`, `dueAt`
  - relation links to bank, branch, org, property, contact, channel
- Channel model hardening:
  - `channelType`, `commissionMode`, `commissionValue`, `isActive`
- Key indexes added/kept for query paths:
  - tasks by tenant/status/assignee/due
  - status history by tenant+assignment+created desc
  - channel requests by tenant+status+created desc and requester ownership path

### SQL RLS + seed extension
- RLS file updated:
  - `/Users/dr.156/ZenOpsV2/infra/sql/010_rls.sql`
- New-table RLS enable/force coverage added for:
  - `tasks`
  - `assignment_status_history`
  - `channel_requests`
  - `branch_contacts`
- Policy behavior added/adjusted:
  - org/tenant isolation for all new master/ops tables
  - `tasks` visibility split:
    - admin/ops: full tenant visibility
    - regular users: assigned-to-me or created-by-me
  - `assignment_status_history` visibility split:
    - admin/ops full
    - assignment creator/assignee readable
  - portal ownership rule for channel requests uses channel owner/user context
- Seed file updated:
  - `/Users/dr.156/ZenOpsV2/infra/sql/020_seed.sql`
- Seed additions:
  - channel records with channel type + commission fields
  - branch contacts
  - sample channel request fixture row

### Contracts + OpenAPI surface updates
- Contract schema updates in:
  - `/Users/dr.156/ZenOpsV2/packages/contracts/src/index.ts`
- Added/expanded contract shapes:
  - assignment lifecycle change payloads
  - task CRUD/list payloads
  - channel request payloads
  - master-data create payloads (bank/branch/channel/branch-contact)
  - analytics overview response schema
- OpenAPI registry updates in:
  - `/Users/dr.156/ZenOpsV2/apps/api/src/openapi.ts`
  - generated: `/Users/dr.156/ZenOpsV2/apps/api/openapi.json`
- Added route docs include:
  - `/v1/banks`, `/v1/bank-branches`, `/v1/client-orgs`, `/v1/contacts`, `/v1/properties`, `/v1/channels`, `/v1/branch-contacts`
  - `/v1/channel-requests`, `/v1/channel-requests/:id/status`
  - `/v1/assignments/:id/status`, `/v1/assignments/:id/status-history`
  - `/v1/tasks`, `/v1/tasks/:id`, `/v1/tasks/:id/mark-done`
  - `/v1/analytics/overview`

### API backend implementation (Nest)
- Core implementation files:
  - `/Users/dr.156/ZenOpsV2/apps/api/src/domain/domain.service.ts`
  - `/Users/dr.156/ZenOpsV2/apps/api/src/domain/domain.controller.ts`
  - `/Users/dr.156/ZenOpsV2/apps/api/src/auth/rbac.ts`
- Master-data module endpoints implemented:
  - banks, bank branches, client orgs, contacts, properties, channels, branch contacts
  - approval endpoints for unverified records
- Assignment lifecycle operations:
  - `POST /v1/assignments/:id/status`
  - `GET /v1/assignments/:id/status-history`
  - transition validator centralized via allowed transition map
  - every transition writes:
    - `assignment_stage_transitions`
    - `assignment_status_history`
    - assignment activity event
- Tasks module endpoints:
  - `GET /v1/tasks` with filters (`assigned_to_me`, `status`, `due_soon`, `overdue`, `assignment_id`)
  - `POST /v1/tasks`
  - `PATCH /v1/tasks/:id`
  - `DELETE /v1/tasks/:id`
  - `POST /v1/tasks/:id/mark-done`
- Channel portal intake/review endpoints:
  - `POST /v1/channel-requests`
  - `GET /v1/channel-requests`
  - `POST /v1/channel-requests/:id/status`
  - accept flow auto-creates assignment + source record when no assignment exists
- Assignment serialization enhancements:
  - source labels and channel aliases for user-facing channel wording
  - completeness score included in assignment list/detail responses
  - status history included in assignment detail
- Analytics hardening endpoint:
  - `GET /v1/analytics/overview`
  - returns counter set (assignments/tasks/channel requests/outbox failed-dead)
  - empty datasets return zeros rather than API failures

### Worker and queue integration
- New worker processors:
  - `/Users/dr.156/ZenOpsV2/apps/worker/src/assignment-signals.processor.ts`
  - `/Users/dr.156/ZenOpsV2/apps/worker/src/task-overdue.processor.ts`
- Worker bootstrap updates:
  - `/Users/dr.156/ZenOpsV2/apps/worker/src/index.ts`
- Queue behavior:
  - assignment transition enqueues recompute signal event with dedupe payload components
  - periodic `recompute_overdue` every 10 minutes updates overdue flags on tasks
- Idempotency pattern preserved:
  - recompute job identities and deterministic filters avoid duplicate flooding

### Frontend updates
- Workspace (`web`) changes:
  - `/Users/dr.156/ZenOpsV2/apps/web/src/App.tsx`
  - New Assignment flow uses master-data selectors (bank/branch/org/property/channel/contact)
  - Assignment detail lifecycle controls:
    - status transition call
    - timeline/history panel
  - My Tasks card uses `/v1/tasks?assigned_to_me=true`
  - Tasks tab uses global tasks filtered by `assignment_id`
  - Added Analytics page with retry + zero fallback state
- Portal changes:
  - `/Users/dr.156/ZenOpsV2/apps/portal/src/App.tsx`
  - channel request submit/list flow
  - user-facing copy uses `Channel`
- Studio changes retained for M4.6 compatibility:
  - ops monitor and manual WhatsApp flows continue to work with new data model

### Tests added/updated
- API unit tests updated:
  - `/Users/dr.156/ZenOpsV2/apps/api/src/domain/domain.service.test.ts`
- Added transition coverage:
  - valid lifecycle transition writes stage transition + status history rows
  - illegal transition path throws guard error
- Worker tests added:
  - `/Users/dr.156/ZenOpsV2/apps/worker/src/assignment-signals.processor.test.ts`
  - `/Users/dr.156/ZenOpsV2/apps/worker/src/task-overdue.processor.test.ts`
- Existing RLS integration suite remained in place and includes tenant/master-data isolation checks:
  - `/Users/dr.156/ZenOpsV2/packages/db/src/__tests__/rls.integration.test.ts`

### Demo + smoke operations
- New script:
  - `/Users/dr.156/ZenOpsV2/scripts/demo-m4.6.sh`
- Smoke checklist:
  - `/Users/dr.156/ZenOpsV2/docs/m4.6-smoke-checklist.md`
- Demo script flow:
  1. login demo actors (web + portal + studio)
  2. create bank + branch + internal channel
  3. create assignment with bank source
  4. transition assignment lifecycle (`DRAFT -> COLLECTING`)
  5. create task assigned to admin user
  6. mark task done
  7. create portal channel request
  8. accept channel request and verify assignment link

### Validation runs completed during M4.6
- `pnpm --filter @zenops/db prisma:generate` passed
- `pnpm --filter @zenops/contracts build` passed
- `pnpm --filter @zenops/api lint` passed
- `pnpm --filter @zenops/api test` passed
- `pnpm --filter @zenops/worker lint` passed
- `pnpm --filter @zenops/worker test` passed
- `pnpm --filter @zenops/web lint` passed
- `pnpm --filter @zenops/portal lint` passed
- `pnpm --filter @zenops/studio lint` passed
- `pnpm --filter @zenops/api openapi:generate` ran and updated `openapi.json`

### Known integration nuance noted
- In launch mode, `aud=portal` tenant mapping remains external lane by default.
- Channel request review for portal-origin rows is handled using a studio token scoped to external lane in demo flow.

## 18) Detailed M4.6.1 Record (V1/V2 Segregation + Port Identity + Control/Data Plane Boundaries)

### Objective
- Remove local runtime ambiguity between V1 and V2 APIs.
- Enforce stable V2 demo targeting even when common ports (`3000`) are occupied.
- Reserve control-plane route namespace early, without implementing subscription/credit business logic yet.
- Keep work additive and migration-safe.

### V2 API identity and control namespace
- Added V2 identity endpoint:
  - `/Users/dr.156/ZenOpsV2/apps/api/src/common/meta.controller.ts`
  - Route: `GET /v1/meta`
  - Payload includes:
    - `app=zenops-v2`
    - `repo_root`
    - `git_sha`
    - `build_time`
    - `service=api`
    - `env=dev|prod`
- Added control-plane route placeholders (RBAC protected, 501):
  - `/Users/dr.156/ZenOpsV2/apps/api/src/control/control.controller.ts`
  - Routes:
    - `GET /v1/control/tenant`
    - `GET /v1/control/subscriptions`
    - `GET /v1/control/credits`
- Wired controllers in module:
  - `/Users/dr.156/ZenOpsV2/apps/api/src/app.module.ts`
- OpenAPI registry updated:
  - `/Users/dr.156/ZenOpsV2/apps/api/src/openapi.ts`
  - regenerated `/Users/dr.156/ZenOpsV2/apps/api/openapi.json`

### Cross-repo V1 identity endpoint
- Added V1 identity endpoint:
  - `/Users/dr.156/zen-ops/backend/app/main.py`
  - Route: `GET /v1/meta`
  - Payload includes:
    - `app=zenops-v1`
    - `repo_root`
    - `git_sha`
    - `build_time`
    - `service=api`
    - `env=dev|prod`
- `git_sha` resolution uses settings value first, then best-effort `git rev-parse`.

### Port detection + script-level hardening
- Added V2 utility:
  - `/Users/dr.156/ZenOpsV2/scripts/detect-zenops-ports.sh`
  - Detects listening Node/Python processes and probes `/v1/meta` and `/v1/health`.
  - Outputs table:
    - `port`
    - `app`
    - `repo_root`
    - `pid`
    - `cmdline`
  - Returns nonzero on multiple V2 API listeners unless `ALLOW_MULTIPLE_V2_APIS=1`.
- Added shared demo resolver:
  - `/Users/dr.156/ZenOpsV2/scripts/lib/resolve-v2-api.sh`
  - Preference order:
    1. `ZENOPS_V2_API_BASE_URL`
    2. `API_BASE_URL`
    3. auto-detected V2 `/v1/meta`
    4. default `http://127.0.0.1:${API_PORT:-3000}/v1` (for can-start mode)
  - Explicit URL mismatch fails fast.

### Demo scripts updated to target V2 explicitly
- Updated scripts:
  - `/Users/dr.156/ZenOpsV2/scripts/demo.sh`
  - `/Users/dr.156/ZenOpsV2/scripts/demo-billing.sh`
  - `/Users/dr.156/ZenOpsV2/scripts/demo-notifications.sh`
  - `/Users/dr.156/ZenOpsV2/scripts/demo-providers.sh`
  - `/Users/dr.156/ZenOpsV2/scripts/demo-mobile-docs.sh`
  - `/Users/dr.156/ZenOpsV2/scripts/demo-m4.6.sh`
- Outcome:
  - scripts no longer silently hit unrelated HTML apps on occupied localhost ports.
  - `demo-m4.6.sh` and `demo-mobile-docs.sh` require an existing validated V2 API.

### Boundary docs added
- `/Users/dr.156/ZenOpsV2/docs/V1_V2_SEGREGATION_REPORT.md`
  - V1 vs V2 responsibility split
  - overlap/conflict inventory
  - non-negotiable separation rules
  - strangler-style migration outline
- `/Users/dr.156/ZenOpsV2/docs/CONTROL_PLANE_BOUNDARIES.md`
  - control-plane vs data-plane contract
  - RLS posture note and Repogen-ready boundary guidance
- `/Users/dr.156/ZenOpsV2/docs/V1_V2_ONE_VPS_HOSTNAMES.md`
  - one-VPS hostname/routing convention
  - minimal Traefik host-rule example

## 19) Detailed M4.6.2 Record (Compose Port Flex + Build Graph Guard + Handoff)

### Objective
- Finalize branch hygiene after M4.6/M4.6.1 by making local/prod compose bindings explicit and configurable.
- Prevent lint-only runs from reading stale type surfaces in dependent workspaces.
- Provide an explicit takeover handoff doc so a new chat can continue without context loss.

### Infra compose changes
- Updated `/Users/dr.156/ZenOpsV2/infra/docker/compose.prod.yml`:
  - Added env-driven host port bindings:
    - `POSTGRES_BIND_PORT` (default `5432`)
    - `REDIS_BIND_PORT` (default `6379`)
    - `API_BIND_PORT` (default `3000`)
    - `WEB_BIND_PORT` (default `5173`)
    - `STUDIO_BIND_PORT` (default `5174`)
    - `PORTAL_BIND_PORT` (default `5175`)
  - Preserved Postgres persistent mount path aligned to image expectations:
    - `zenops_pgdata:/var/lib/postgresql`

### Build orchestration update
- Updated `/Users/dr.156/ZenOpsV2/turbo.json`:
  - `lint` now depends on `^build` in addition to `^lint`.
  - This ensures lint/type-aware consumers evaluate against built upstream packages and avoids false negatives caused by stale generated outputs.

### Documentation added
- Added `/Users/dr.156/ZenOpsV2/docs/handoff-m4.6-takeover.md` with:
  - branch + head snapshot
  - completed M4.6 and M4.6.1 summary
  - current local deltas and validation checklist
  - exact next-chat continuation commands
