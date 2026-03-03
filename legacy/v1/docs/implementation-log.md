# ZenOps V1 Implementation Log

Last updated: 2026-03-03

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
