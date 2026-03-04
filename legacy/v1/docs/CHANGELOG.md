# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Conventional Commits for messages.

## [Unreleased]

## [v1-pilot-rc1-2026-03-04]

### Added
- Pilot RC integration branch `codex/v1-phase9-pilot-rc` merging completed phase streams:
  - Phase 2 approvals + draft assignments
  - Phase 3 invoices/payments/adjustments
  - Phase 4 policy-driven land + service-line master data
  - Phase 5 ops UX surfaces
  - Phase 6 associate onboarding (self-serve + verification)
  - Phase 7 allocation eligibility/workload policy
  - Phase 8 deploy/security hardening
  - Phase 8.6 stabilization patchset
- PostgreSQL-only test session helper for Phase RC suites: `backend/tests/postgres_utils.py`.
- Alembic migration `0042_phase9_partner_request_status_len` to support Phase 6 onboarding status values.

### Changed
- RC phase suites now run against PostgreSQL (Docker Compose DB) instead of SQLite shims.
- `scripts/smoke_prod_like.sh` now validates:
  - `/healthz`, `/readyz`, `/version`
  - production CORS deny for unknown origin
  - login rate-limit threshold behavior
  - non-prod associate request-access + verify flow (201 + token verification)
  - backups endpoint admin-only guard (non-admin denied)
  - isolated host-port binding and clean DB volume startup for deterministic local smoke runs.

### Fixed
- Added missing outbox integration artifacts required by merged branches:
  - `app/models/v1_outbox_event.py`
  - `alembic/versions/0035_add_v1_outbox_events.py`
  - `app/services/v1_outbox.py`
- Widened `partner_account_requests.status` model column to `String(40)` to avoid Postgres truncation failures on `VERIFIED_PENDING_REVIEW`.

### Added
- Multi-role user model with capability union and partner single-role enforcement.
- Notification delivery tracking and email worker processing for queued notifications.
- Partner portal and partner admin flows for external requests and commissions.
- Backup API and admin UI surface for backup status and downloads.
- Deterministic OpenAPI generator script at `scripts/generate_openapi.py` for refreshing `docs/openapi.json`.
- Support resolve regression test (`backend/tests/test_support_api_resolve.py`) to verify resolved timestamp persistence.
- Terminology guard script (`scripts/terminology_check.sh`) to catch accidental Partner copy in UI text.
- Phase 4 data model primitives for policy-driven assignments:
  - `service_lines` + `service_line_policies`
  - `assignment_land_surveys`
  - assignment fields for `uom`, service-line master linkage, per-assignment land policy override, and admin payment preferences.
- Seed packs for service lines and land policy defaults:
  - `docs/seed/service_lines.seed.json`
  - `docs/seed/service_line_policies.seed.json`
- Service line master-data APIs under `/api/master/service-lines` and `/api/master/service-line-policies`.
- Phase 6 associate onboarding guide: `docs/PHASE6_ASSOCIATE_ONBOARDING.md`.
- Public onboarding endpoint `POST /api/partner/verify-access-token` with backward-compatible alias `/api/partner/verify`.
- Public onboarding helper endpoint `POST /api/partner/resend-verification`.
- Alembic migration `0041_phase6_associate_self_onboarding` for onboarding lifecycle fields.

### Changed
- Reverse proxy configuration to preserve `/api` paths and support localhost HTTP/HTTPS.
- CORS and JWT safety checks for production startup validation.
- Regenerated `docs/openapi.json` to align with current FastAPI routes (including bridge-token and mobile endpoints).
- Frontend API calls now consistently use the shared API client/interceptors (no rogue local axios instances).
- Attendance CSV export now uses shared API client transport instead of raw fetch/manual auth headers.
- User-facing terminology updated from Partner to Associate across navigation, headings, and admin/portal labels.
- Assignment create/update flows now support:
  - master-driven service lines (`service_line_id`) with `Others` validation,
  - mandatory `uom`,
  - policy-gated survey rows,
  - admin-only assignment payment preference fields.
- New Assignment UI now renders land detail blocks from service-line policy, restores create-time document upload, and supports admin override controls.
- Admin Master Data page now includes Service Lines tab with policy JSON editing.
- Associate onboarding now supports mode-based behavior (`INVITE_ONLY`, `REQUEST_ACCESS_REVIEW`, `REQUEST_ACCESS_AUTO_APPROVE`).
- Public request-access UX now routes to `/partner/request-access/sent` with resend-verification support.

### Fixed
- Frontend API base handling to avoid double `/api` pathing.
- Healthcheck host handling to prefer IPv4 for local checks.
- Support resolve endpoint now persists `closed_at` correctly and returns it consistently after refresh.

### Security
- Login rate limiting based on ActivityLog window and IP/email tracking.
- Associate onboarding verification tokens are one-time, hashed, and TTL-bound.
- Associate onboarding verify/resend endpoints now enforce DB-backed rate limits.
