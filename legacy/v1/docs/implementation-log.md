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
