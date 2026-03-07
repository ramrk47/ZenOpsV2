# Phase 8.5 QA Runbook (Maulya V1)

## Scope
- Runs full Playwright harness for `legacy/v1` only.
- Covers core internal workflows, approvals, invoices, master data, partner onboarding, DOM crawler, and chaos checks.

## Prerequisites
- Docker + Docker Compose.
- Node 18+.
- Playwright browser dependencies installed once:
  - `cd legacy/v1/frontend && npx playwright install --with-deps`

## One-command full run
```bash
cd legacy/v1
./ops/e2e_full.sh
```

The script performs:
1. Starts `db`, `backend`, `frontend`, `email-worker`.
2. Runs DB migrations.
3. Runs deterministic reset/seed via `scripts/seed_e2e.sh`.
4. Runs Playwright suite with `playwright.config.ts`.
5. Prints HTML report path.

## Direct suite commands
```bash
cd legacy/v1/frontend
npm run e2e:full
npm run e2e:crawler
npm run e2e:approve
```

## Reports and artifacts
- HTML report:
  - `legacy/v1/frontend/playwright/test-results/html-report/index.html`
- Per-test artifacts (screenshots/videos/trace):
  - `legacy/v1/frontend/playwright/test-results/artifacts/`
- DOM crawler JSON report:
  - `legacy/v1/frontend/playwright/test-results/dom-crawler-report.json`

## Test-only flags
- `ASSOCIATE_AUTO_APPROVE` (default in `ops/e2e_full.sh`: `1` for automation):
  - Non-production onboarding shortcut for `/partner/request-access`.
  - Guarded in backend and ignored in production path:
    - `backend/app/core/settings.py` (`settings.is_production`)
    - `backend/app/routers/partner_onboarding.py` (`_auto_approve_non_prod_enabled`).
- `ASSOCIATE_AUTO_APPROVE_PASSWORD`:
  - Password used for auto-approved associate logins in non-production.
- `E2E_DESTRUCTIVE` (default `0`):
  - Enables destructive clicks in DOM crawler when set to `1`.

## Recommended execution order in CI or pre-release
1. `./ops/e2e_full.sh`
2. If failed, rerun only failing specs with trace viewer.
3. Run DOM crawler alone with `E2E_DESTRUCTIVE=0` as baseline.
