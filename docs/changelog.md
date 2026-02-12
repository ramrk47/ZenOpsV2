# ZenOps v2 Changelog

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
