# ZenOps v2 Changelog

## 2026-02-24

### Added (M5.5 Repogen Factory Flow - Spine -> Pack Bridge, No Templates)
- M5.5 Repogen factory bridge connecting M5.4 work orders to M5.3 pack/job pipeline:
  - work-order <-> report-pack linkage (`repogen_work_orders.report_pack_id`, `report_packs.work_order_id`)
  - `repogen_deliverable_releases` audit/idempotency table for manual deliverables release
- Repogen factory API bridge + release endpoints:
  - `POST /v1/repogen/work-orders/:id/create-pack`
  - `GET /v1/repogen/work-orders/:id/pack`
  - `POST /v1/repogen/work-orders/:id/release-deliverables`
- READY transition auto-bridge:
  - `READY_FOR_RENDER` now auto-creates/links pack + queued generation job (no auto-release)
- Deliverables release billing gate enforcement at release time:
  - CREDIT -> consume reserved credit (idempotent)
  - POSTPAID -> require paid invoice or audited override with reason
- Web/Studio operator UI updates for factory operations:
  - pack/job/artifact visibility
  - billing gate visibility
  - manual release flow with override reason
- Worker placeholder generation metadata now includes deterministic export bundle hash for factory jobs.
- Additional M5.5 tests:
  - factory bridge idempotency
  - deliverables release idempotency + billing gates
  - worker artifact metadata hash propagation
  - RLS integration fixture coverage for `repogen_deliverable_releases`
- M5.5 architecture/runbook doc:
  - `docs/REPOGEN_FACTORY_FLOW_M5_5.md`

### Added (M5.4 Repogen Spine v1 - No DOCX Generation)
- Repogen v1 deterministic data spine in V2 (no DOCX rendering yet):
  - `repogen_work_orders`
  - `repogen_contract_snapshots` (immutable versioned snapshots)
  - `repogen_evidence_items`
  - `repogen_rules_runs`
  - `repogen_comments`
- RLS coverage for all `repogen_*` tables with `org_id` tenant isolation plus portal ownership policy for channel-sourced work orders.
- Repogen canonical contract + API zod contracts in `packages/contracts` and OpenAPI path registry entries for `/v1/repogen/*`.
- Repogen rules engine + readiness evaluator (M5.4-v1):
  - FMV / 95% / 80%
  - co-op adopted/market inversion
  - sqft->sqm standardization
  - co-op round-up-to-next-500
  - deterministic template selector metadata and readiness scoring
- Repogen V1 API endpoints:
  - create/list/detail work orders
  - patch contract -> snapshot/rules run/recompute
  - evidence link
  - comments
  - status transitions with readiness gates
  - deterministic export bundle JSON
- Worker placeholder hook:
  - `repogen-compute-snapshot` queue + processor
  - idempotent `jobId=work_order_id:snapshot_version`
- Minimal operator UI surfaces:
  - Studio Repogen read-only monitoring tab (list/detail + JSON inspectors)
  - Web Tenant #1 Repogen production queue page (create/patch/evidence/comments/status/export preview)
- M5.4 tests:
  - rules engine unit tests
  - readiness evaluator unit tests
  - repogen spine service flow tests
  - worker placeholder processor test
  - RLS integration test coverage for `repogen_*` tables

### Added (M5.3 Repogen Spine Phase 1)
- Assignment-level report generation spine for `SBI_UNDER_5CR_V1` with worker-based placeholder generation and pack/artifact persistence.
- Repogen/report-pack data model (`report_packs`, `report_pack_artifacts`, `report_field_values`, `report_evidence_links`, `report_generation_jobs`, `report_audit_logs`).
- Assignment report-generation UI panel and supporting API/queue/worker paths.

## 2026-02-15

### Added (M5.0 Launchable Billing Wiring)
- Credit reconciliation endpoint:
  - `POST /v1/control/credits/reconcile` for cron-safe reserve consume/release cleanup
  - supports `dry_run`, `tenant_id`, and bounded scan limits
- Studio operator actions:
  - reconciliation dry-run and execute buttons in credits tab
- Web app invoices lane:
  - list/filter service invoices
  - create draft, issue, and mark paid actions
- Portal billing visibility:
  - invoice status surfaced with channel requests
  - "My Invoices" section with payment-proof metadata submission (`/v1/service-invoices/:id/payment-proof`)
- Smoke script coverage:
  - `scripts/smoke-v2.sh` now validates both credit lifecycle and postpaid invoice flow and runs reconciliation dry-run.

### Added (M4.9 Credits + Postpaid Billing Productization)
- Credit system hardening:
  - `billing_credit_balances` table support in Prisma + RLS + invariant check constraint
  - stricter reserve/consume/release state enforcement and balance invariants
  - operator override reserve mode with explicit adjustment ledger entry
  - timeline events for grant/reserve/consume/release
- Service invoice compatibility routes (for V1 migration path):
  - `/v1/service-invoices/*` alias endpoints
  - `POST /v1/service-invoices/:id/mark-paid`
  - idempotent issue via `Idempotency-Key`
- Studio auth hardening:
  - temporary `STUDIO_ADMIN_TOKEN` support for `/v1/control/*`
  - control-plane request throttling via `CONTROL_RATE_LIMIT_RPM`
- Launch docs/scripts:
  - `docs/CREDIT_SYSTEM_RULEBOOK.md`
  - `docs/VPS_DUAL_DEPLOY_RUNBOOK.md`
  - `scripts/smoke-v2.sh`

### Added (M4.8 Billing Operator Surfaces)
- V2 control-plane credit operations expanded for Studio operator usage:
  - `GET /v1/control/accounts/:id/status`
  - `GET /v1/control/credits/tenant/:tenantId`
  - `GET /v1/control/credits/reservations`
  - `GET /v1/control/credits/timeline`
  - `POST /v1/control/credits/reserve`
  - `POST /v1/control/credits/consume`
  - `POST /v1/control/credits/release`
- Studio app moved from diagnostics-only to billing-first control surface:
  - account picker + policy toggle
  - credit wallet/reserved/available cards
  - grant credits and manual reserve controls
  - reservations action table (consume/release)
  - merged billing timeline (ledger + usage + service invoices)

### Added (M4.7 Billing Spine + V1 Handshake Enablement)
- Billing control-plane and service invoicing foundations in V2:
  - new Prisma billing models and enums
  - control + billing + invoices API controllers/services
  - control-plane account/policy/credits/subscription operations wired
  - V2 billing status lookup by external account key (`GET /v1/billing/accounts/status?external_key=...`)
- V2 docs:
  - `docs/m4.7-dual-vps-launch-readiness.md`
  - `docs/m4.7-smoke-checklist.md`

### Changed (M4.7)
- Domain/service wiring updated for channel acceptance billing actions and billing-gated download checks.
- SQL RLS/seed files expanded for billing control-plane and service invoice tables.

### Added (M4.6.1 V1/V2 Segregation + Port Identity)
- V2 API identity endpoint:
  - `GET /v1/meta` returning app/repo/git/build/env identity payload
- V2 control-plane namespace reservation endpoints (RBAC-protected, 501 by design):
  - `GET /v1/control/tenant`
  - `GET /v1/control/subscriptions`
  - `GET /v1/control/credits`
- New V2 port detection utility:
  - `scripts/detect-zenops-ports.sh`
  - probes `/:port/v1/meta` and prints `port/app/repo_root/pid/cmdline`
  - exits nonzero when multiple V2 API listeners are found unless explicitly allowed
- Cross-system segregation docs:
  - `docs/V1_V2_SEGREGATION_REPORT.md`
  - `docs/CONTROL_PLANE_BOUNDARIES.md`
  - `docs/V1_V2_ONE_VPS_HOSTNAMES.md`

### Changed (M4.6.1)
- V2 demo scripts now prefer `ZENOPS_V2_API_BASE_URL` and validate target identity via `/v1/meta` before running:
  - `scripts/demo.sh`
  - `scripts/demo-billing.sh`
  - `scripts/demo-notifications.sh`
  - `scripts/demo-providers.sh`
  - `scripts/demo-mobile-docs.sh`
  - `scripts/demo-m4.6.sh`
- Added shared resolver helper:
  - `scripts/lib/resolve-v2-api.sh`
- README updated with segregation utility references and new base-URL convention.

### Added (M4.6 Assignment Ops Factory + Master Data Spine)
- Assignment lifecycle operations:
  - `POST /v1/assignments/:id/status`
  - `GET /v1/assignments/:id/status-history`
  - transition audit rows in `assignment_status_history`
- Master-data operational CRUD surfaces:
  - banks, bank branches, client orgs, contacts, properties, channels
  - branch contacts
  - channel request intake/review (`/v1/channel-requests`, `/v1/channel-requests/:id/status`)
- Real task board primitives:
  - `/v1/tasks` list/create/update/delete
  - `/v1/tasks/:id/mark-done`
  - overdue recompute worker and assignment-signal recompute worker
- Analytics fallback endpoint:
  - `GET /v1/analytics/overview` (safe zero counters when data is empty)
- New demo flow:
  - `scripts/demo-m4.6.sh`

### Changed (M4.6)
- Prisma/schema expansion for ops factory and master data:
  - `tasks`, `assignment_status_history`, `channel_requests`, `branch_contacts`
  - assignment source/master foreign key normalization and lifecycle mapping
- RLS policy coverage extended to all new M4.6 tables with portal ownership filtering for channel requests.
- Workspace/web UI:
  - assignment detail lifecycle status actions + timeline panel
  - assignment tasks wired to global task endpoints
  - analytics page with retry + safe fallback
  - channel wording retained user-facing (`Channel`, not `Partner`)
- Portal UI:
  - channel request submit/list flow
  - user-facing copy uses `Channel`
- Worker startup now includes M4.6 processors and deduped queue scheduling.

### Added
- M4.4 delivery merged (`PR #4`, merge commit `2df39c2136b1549cf5df15c007639e9b5c03219f`, tag `m4.4`).
- Mobile document metadata and linkability support:
  - new document source/classification/sensitivity enums
  - captured timestamp and captured-by employee tracking
  - optional employee linkage in document links
- New role/routing administration APIs:
  - `GET /v1/roles/templates`
  - `POST /v1/employees/:id/role`
  - `POST /v1/roles/contact-points`
- Manual WhatsApp month-1 operational APIs:
  - `POST /v1/notifications/manual-whatsapp`
  - `POST /v1/notifications/outbox/:id/mark-manual-sent`
- Studio ops monitor API:
  - `GET /v1/notifications/ops-monitor`
- UI additions:
  - web mobile upload and tag-on-upload flow in assignment detail
  - studio ops monitor panel and manual send controls
- New demo:
  - `scripts/demo-mobile-docs.sh`

### Changed
- OpenAPI registry expanded to include new M4.4 routes and admin surfaces.
- SQL policy/index support updated for document metadata query patterns and employee-link constraint handling.
- Document listing/upload behavior now supports classification/source/sensitivity filters and metadata enrichment.

### Added
- M4.5 delivery merged (`PR #5`, merge commit `ad46e757180da8cdcf621788567ffff1812fbcfd`, tag `m4.5`).
- VPS production-like deploy stack:
  - `infra/docker/compose.vps.yml` (Traefik edge + TLS + host routing)
  - BasicAuth middleware path for Studio and API docs (plus optional webhook gating)
- Production env template:
  - `.env.prod.example`
- Ops scripts:
  - `scripts/prod-backup-db.sh`
  - `scripts/prod-restore-db.sh`
  - `scripts/prod-pre-migrate-backup.sh`
  - `scripts/prod-offhours.sh`
  - `infra/docker/ops/cron.example`
- M4.5 deployment runbook:
  - `docs/deploy-runbook-m4.5.md`

### Changed
- README updated with M4.5 deployment/ops asset references.
- Deploy posture formalized to always-on VPS with off-hours worker downshift instead of host sleep semantics.

## 2026-02-12

### Added
- M4.3 RBAC surface in API auth with role-to-capability expansion at login and capability metadata checks in `JwtAuthGuard`.
- Notification webhook coverage for Mailgun (`/v1/webhooks/mailgun`) alongside existing Twilio/SendGrid verification paths.
- Worker notification provider adapters for real delivery:
  - Mailgun email via `/v3/{domain}/messages`
  - Twilio WhatsApp via Messages API
- `scripts/demo-providers.sh` for NOOP-first provider demo with optional real sends when credentials are present.
- New tests for:
  - capability enforcement in guard/domain service
  - webhook status mapping (`403` disabled, `401` invalid signature)
  - provider adapter failure safety when secrets are missing.

### Changed
- Added provider/env config keys in `packages/config`:
  - `NOTIFY_PROVIDER_EMAIL`, `NOTIFY_PROVIDER_WHATSAPP`
  - `MAILGUN_*`, `TWILIO_*`, and `MAILGUN_WEBHOOK_VALIDATE`.
- API endpoints for employees/attendance/payroll/notification-route and notifications admin outbox/test are now capability-gated.
- Notification worker now resolves effective provider from channel + env defaults when outbox rows are `noop`.
- Seed roles extended for internal operating model (`super_admin`, `ops_manager`, `valuer`, `accounts`, `hr`).
- Demo billing/notifications scripts updated to request appropriate capabilities at login.

## 2026-02-11

### Added
- `packages/storage` with `StorageProvider`, `S3CompatibleProvider`, `LocalDiskProvider`, and storage key helper.
- Document registry and report-input schema spine:
  - `documents`, `document_links`
  - `document_tag_keys`, `document_tag_values`, `document_tag_map`
  - `input_schemas`, `report_inputs`, `extraction_runs`
- API routes for file presign/confirm/download, document metadata/tags/listing, and report data-bundle read/write.
- Worker pre-processing hook to load data-bundle metadata during draft queue processing.
- New/expanded tests for single-tenant gating, link correctness, schema-version optimistic checks, and document isolation fixtures.
- Smoke-validation record in implementation docs with successful end-to-end API flow:
  - login -> report_request -> data-bundle patch -> file presign/confirm -> tags/metadata -> listing/filtering -> presign download.

### Changed
- `.env.example` and `packages/config` extended with `STORAGE_DRIVER` and `S3_*` settings.
- `.env.example` now includes local bind port defaults for infra-only compose:
  - `POSTGRES_BIND_PORT=55432`
  - `REDIS_BIND_PORT=56379`
- `infra/sql/010_rls.sql` expanded with role-scoped policies for document and report-input tables plus portal isolation controls.
- `infra/sql/020_seed.sql` updated so role seeds insert explicit UUID ids (`gen_random_uuid()`).
- `apps/portal` now keeps external tenant lane fixed in UI (displayed but not editable).
- `turbo.json` updated so `lint` depends on `^build` to avoid stale workspace type surfaces.
- `apps/api/openapi.json` and generator updated with new endpoint paths.
- `scripts/bootstrap-db.mjs` updated for current Prisma CLI semantics and absolute path handling.
- Compose files updated for Postgres 18 volume path (`/var/lib/postgresql`) and host-port overrides:
  - `POSTGRES_BIND_PORT`, `REDIS_BIND_PORT`
  - `API_BIND_PORT`, `WEB_BIND_PORT`, `STUDIO_BIND_PORT`, `PORTAL_BIND_PORT`
- `infra/docker/compose.infra.yml` is now the infra-only mode (`postgres`, `redis`) for local development.
- `infra/docker/compose.dev.yml` no longer hard-codes `container_name` values and keeps Linux dependencies isolated with named `/app/node_modules` volumes.
- Root compose scripts now default to project names that avoid Zen v1 collisions:
  - `zenopsv2-infra` for infra-only
  - `zenopsv2` for full dev
- `apps/api` request-id middleware updated for Fastify raw response compatibility.
- Added missing Fastify dependency for Swagger static assets: `@fastify/static`.

### Notes
- Multi-tenant architecture remains intact; launch gating behavior remains unchanged (`ZENOPS_MULTI_TENANT_ENABLED=false` default).
- Prisma version pin remains exact: `prisma@6.19.2`, `@prisma/client@6.19.2`.
- Single-tenant launch gate explicitly validated with expected `403 TENANT_NOT_ENABLED` for non-internal web tenant tokens.

## 2026-02-15

### Changed
- Production compose bind ports in `/Users/dr.156/ZenOpsV2/infra/docker/compose.prod.yml` are now env-driven for safer side-by-side local/server runs:
  - `POSTGRES_BIND_PORT`, `REDIS_BIND_PORT`
  - `API_BIND_PORT`, `WEB_BIND_PORT`, `STUDIO_BIND_PORT`, `PORTAL_BIND_PORT`
- Postgres data path in compose remains aligned to Postgres 18 image layout (`/var/lib/postgresql`) while keeping persisted volume mount.
- Turbo task graph updated in `/Users/dr.156/ZenOpsV2/turbo.json` so `lint` depends on `^build` and avoids stale cross-workspace type surfaces.

### Added
- M4.6 continuation handoff for next chat:
  - `/Users/dr.156/ZenOpsV2/docs/handoff-m4.6-takeover.md`
