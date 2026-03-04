# ZenOps V1 Implementation Log

Last updated: 2026-03-04

## Phase 0.1 - OpenAPI Drift Stabilization
- Added deterministic schema generator: `scripts/generate_openapi.py`.
- Regenerated `docs/openapi.json` from live FastAPI app routes.
- Verified contract snapshot health:
  - `python3 scripts/contract_check.py`
  - Result: `Scanned 230 call sites. Mismatches: 0`

## Phase 0.2 - Frontend API Client Consistency
- Removed non-canonical axios usage from:
  - `frontend/src/pages/AdminDashboard.jsx`
  - `frontend/src/pages/PartnerRequestAccess.jsx`
  - `frontend/src/components/ErrorBoundary.jsx`
- Removed remaining raw `fetch` auth bypass in attendance export:
  - `frontend/src/pages/admin/AdminAttendance.jsx`
  - `frontend/src/api/attendance.js`
- Standardized updated callsites to use shared `frontend/src/api/client.js` client wrappers/interceptors.
- Verified remaining axios usage is centralized in `frontend/src/core/api/client.js`.

## Phase 0.3 - Support Resolve Timestamp Persistence
- Fixed support resolve persistence mismatch:
  - `backend/app/routers/support.py`
  - `POST /api/support/threads/{thread_id}/resolve` now writes `closed_at` (canonical DB column).
- Added regression coverage:
  - `backend/tests/test_support_api_resolve.py`
  - Asserts resolve sets timestamp and value persists when thread is fetched again.
- Verification command:
  - `PYTHONPATH=/work pytest tests/test_support_api_resolve.py -q`
  - Result: `1 passed`

## Phase 1.1 - Terminology Pass (Partner -> Associate, UI only)
- Updated user-facing copy across admin and portal UI surfaces:
  - navigation labels, page headers, status copy, empty states, prompts.
- Kept technical identifiers unchanged:
  - API paths remain `/api/partner/*`
  - Route paths remain `/partner/*`
  - role enum remains `EXTERNAL_PARTNER`
- Added terminology guard:
  - `scripts/terminology_check.sh`
  - Result: `PASS` (only technical partner references remain)

## Phase 4 - Policy-Driven New Assignment (Service Lines + Land Survey Model)
- Added migration `0037_phase4_policy_driven_land`:
  - New tables: `service_lines`, `service_line_policies`, `assignment_land_surveys`
  - New assignment columns: `service_line_id`, `service_line_other_text`, `uom`, `land_policy_override_json`,
    `payment_timing`, `payment_completeness`, `preferred_payment_mode`
  - Seeded service-line defaults and default policy JSON per service line.
- Added backend models/schemas for:
  - Service line master + policy
  - Assignment land survey rows (with kharab values)
- Added master-data APIs:
  - `GET/POST/PATCH /api/master/service-lines`
  - `GET /api/master/service-line-policies`
  - `PATCH /api/master/service-lines/{id}/policy`
- Updated assignment APIs:
  - Enforced mandatory `uom`
  - Enforced `Others` requires description
  - Policy-driven survey row validation (`SURVEY_ROWS` required when configured)
  - Admin-only enforcement for assignment-level policy/payment preference fields
  - Assignment responses now include service-line label, effective land policy, survey rows, and survey totals.
- Frontend updates:
  - New Assignment now uses backend service-line master data and policy-driven block rendering.
  - Added survey-row repeater + live totals for agri/land workflows.
  - Restored create-time initial document upload section.
  - Added admin-only assignment payment preference + policy override controls.
  - Added `Service Lines` tab in Admin Master Data for CRUD + policy JSON updates.
- Added phase 4 backend test file:
  - `backend/tests/test_phase4_service_lines_assignments.py`

Verification run:
- `python3 -m compileall ...` on touched backend files: PASS
- `docker compose -f docker-compose.dev.yml run --rm backend alembic upgrade head`: PASS
- `npm --prefix frontend run build`: PASS
- `docker compose ... run --rm backend pytest ...`: BLOCKED in this environment because backend image does not include `backend/tests` paths by default.

## Phase 6 - Associate Self-Onboarding (Mode-Based, Email-Verified)
- Added onboarding mode controls in backend settings:
  - `ASSOCIATE_ONBOARDING_MODE` (`INVITE_ONLY`, `REQUEST_ACCESS_REVIEW`, `REQUEST_ACCESS_AUTO_APPROVE`)
  - `ASSOCIATE_EMAIL_VERIFY_REQUIRED`
  - `ASSOCIATE_VERIFY_TOKEN_TTL_MINUTES`
  - `ASSOCIATE_AUTO_APPROVE_DOMAINS`
  - `ASSOCIATE_AUTO_APPROVE_MAX_PER_DAY`
- Added migration `0041_phase6_associate_self_onboarding` to extend `partner_account_requests` with:
  - `city`, `role_intent`, `requested_interface`, `metadata_json`
  - `token_expires_at`, `token_consumed_at`
  - `approved_at`
- Updated onboarding backend flow:
  - `POST /api/partner/request-access` now mode-aware and email-verification-first by default.
  - Added `POST /api/partner/verify-access-token` (retained `/api/partner/verify` alias).
  - Added `POST /api/partner/resend-verification`.
  - Auto-approve path now provisions associate account/profile after successful verification.
- Updated frontend onboarding UX:
  - `PartnerRequestAccess.jsx` now posts richer payload and routes to new `/partner/request-access/sent`.
  - Added `PartnerRequestAccessSent.jsx` with resend-verification action.
  - `PartnerVerifyAccess.jsx` now calls `/api/partner/verify-access-token` and surfaces activation/review outcomes.
- Admin associate requests page now treats `PENDING_EMAIL_VERIFY` / `VERIFIED_PENDING_REVIEW` as pending review states.
- Added/updated backend tests in `backend/tests/test_phase6_onboarding.py` for:
  - pending request creation + verification mail
  - one-time token consumption
  - auto-approve provisioning
  - review-mode approval invite and partner RBAC isolation

## Phase 8.6 - Stabilization Patchset (Console-Clean + Guardrails)
- P1-A DOM nesting warning on `/assignments` KPI tiles:
  - Updated `frontend/src/components/ui/KpiTile.jsx` to render `InfoTip` as non-button when tile is clickable.
  - Updated `frontend/src/components/ui/InfoTip.jsx` to support `as=\"span\"` and stop click propagation.
- P1-B Duplicate React key (`FINAL_REVIEW`) in Assignment approvals action selector:
  - Updated `frontend/src/pages/AssignmentDetail.jsx` to deduplicate action list via `Set` before rendering options.
- P1-C New Assignment assignee eligibility guardrail:
  - Updated `frontend/src/pages/NewAssignment.jsx` to remove default self-assignment, filter assignee options by service-line allocation policy + deny roles, auto-clear stale ineligible selections, and surface `ASSIGNEE_NOT_ELIGIBLE` with clear UI text.
- P2 Backups page 403 noise for non-admin roles:
  - Updated `frontend/src/App.jsx` with strict admin-role guard on `/admin/backups`.
  - Updated `frontend/src/components/sidebars/AdminSidebar.jsx` to show Backups only for admins.
  - Updated `frontend/src/pages/admin/AdminBackups.jsx` to short-circuit fetch/trigger logic for non-admin users.
- P3-A Sidebar navigation click stability:
  - Updated `frontend/src/components/sidebars/AdminSidebar.jsx` group toggles to semantic `<button>` with `aria-expanded`/`aria-controls`.
  - Updated `frontend/src/styles.css` to disable pointer events on collapsed nav groups and prevent hidden overlay interception.
- P3-B Logout consistency hardening:
  - Updated `frontend/src/auth/AuthContext.jsx` for atomic local teardown, stale-refresh epoch guard, and redirect fallback.
- Added Playwright stabilization smoke coverage:
  - `frontend/playwright/utils/console-guard.ts`
  - `frontend/playwright/tests/stabilization_smoke.spec.ts`
