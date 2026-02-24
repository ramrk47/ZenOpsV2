# Smoke Tests

## Exact Commands

Run from repo root: `/Users/dr.156/zen-ops`

```bash
# 1) Start core stack

docker compose up -d

# 2) Confirm containers

docker compose ps

# 3) Apply DB migrations (safe, no volume recreation)

docker compose run --rm migrate

# 4) Seed demo data (if required for UI journeys)

docker compose exec api python -m app.seed

# 5) Ensure deterministic E2E login user (safe for non-production)

docker compose exec api python -m app.scripts.ensure_e2e_user

# 6) Readiness check through reverse proxy

curl -sS http://localhost/readyz

# 7) Health check with dependency queue stats

curl -sS http://localhost/healthz

# 8) Contract drift gate

python3 scripts/contract_check.py --strict

# 9) Frontend production build check

npm --prefix frontend run build

# 10) Optional backend test pass

PYTHONPATH=backend python3 -m pytest backend/tests -q
```

## Manual Smoke Checklist

1. Login with a valid seeded user and verify redirect to expected home route.
2. Open each primary sidebar destination (Assignments, Calendar, Notifications, Invoices, Requests).
3. Open an assignment detail and switch all tabs:
   - Overview
   - Documents
   - Tasks
   - Timeline
   - Chat
   - Approvals
   - Finance
   - Outputs
4. Upload a small dummy file in assignment documents.
5. Open document preview drawer; add comment; resolve comment.
6. Navigate admin pages:
   - Master Data
   - Personnel
   - Support Inbox
   - Backups
7. Validate partner account cannot access employee/admin-only routes.
8. Validate `/readyz`, `/healthz`, and `/metrics` endpoints return success.
9. Check API logs for structured JSON with `request_id` and `X-Request-Id` response header.

## Playwright Entrypoints

Run from repo root unless noted.

```bash
# default suite
npm --prefix frontend run test:e2e

# focused suites used in this repo
npx --yes playwright test playwright/tests/smoke.spec.js
npx --yes playwright test playwright/tests/api-smoke.spec.js
npx --yes playwright test playwright/tests/full-explore.spec.js
npx --yes playwright test playwright/tests/ultra-truth-scan.spec.js
```

## Screenshot Output Path

- Primary path: `reports/screenshots/`
- Existing suite artifacts also appear under: `playwright/reports/screenshots/`

## Baseline Diagnostic Artifacts

- Readiness baseline: `ops/diagnostics/readyz-baseline.json`
- Full compose logs baseline: `ops/diagnostics/logs-baseline.txt`
- Error grep from baseline logs: `ops/diagnostics/logs-baseline-errors.txt`
