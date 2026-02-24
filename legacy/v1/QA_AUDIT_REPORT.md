# ZenOps QA Audit Report — Truth Scan

Date: 2026-02-10

## Executive Summary (Top 10 Blockers)
1. **S2: Frontend runtime error in mentions** — `highlightMentions is not defined` thrown in production bundle; ErrorBoundary catches it, but it interrupts messaging/comment UX.
2. **S3: Email provider disabled in dev** — Email worker logs show delivery skipped; ensure environment config for real delivery in staging/production.
3. **S3: Grafana update checks in logs** — benign but adds noise to error scans.

> Note: No 4xx/5xx responses were captured by the truth scan harness, and no request failures were recorded during the 9.2-minute run. All pages and workflows loaded, but the JS runtime error indicates a broken mentions feature.

## Severity Rubric
- **S1**: Crash/security/workflow-blocker
- **S2**: Major feature broken (persistent 404/500)
- **S3**: UX issues, minor errors

## Environment / Evidence
- Diagnostics: `ops/diagnostics/20260210_025712/`
- Action log: `ops/diagnostics/20260210_025712/action_log.json`
- Screenshots: `playwright/reports/screenshots/` (405 tooltip + 405 click captures)
- Playwright report: `playwright/reports/html/`
- Trace/video artifacts: `playwright/reports/test-results/`

## Coverage Summary
- **Navigation:** Visited all sidebar labels via UI click, with fallback direct URLs when needed.
- **Explorer Engine:** Hovered/clicked first 15 actionable elements per page with safety rules; 810 actions recorded.
- **Workflows:** Auth, Assignments (tabs), Documents (preview + comment), Templates, Support Inbox, Payroll (runs/employees/reports + run detail tabs), Review & Audit, Backups.
- **Artifacts:** Full-page screenshots per step, action log JSON, Playwright HTML report.

## Issues Found

| Severity | Area | Evidence | Repro Steps | Suspected Root Cause | Fix Suggestion |
|---|---|---|---|---|---|
| S2 | Mentions/Comments | `consoleErrors` in `action_log.json`; Playwright console error | Open Assignment → Documents → Preview drawer → comment tab | Missing `highlightMentions` function in frontend bundle | Ensure mentions utility is exported/imported; add unit test for mention rendering; guard calls when module missing |
| S3 | Email Worker | `ops/diagnostics/20260210_025712/error_index.txt` | Observe email worker logs | Email provider disabled in dev config | Document env flag, ensure staging has provider enabled |
| S3 | Grafana | `error_index.txt` | Run logs grep | Update check info logged as errors due to broad grep | Adjust log filters or refine regex when building error index |

## Fix Order (80/20)
1. Fix missing `highlightMentions` import and add defensive fallback (S2).
2. Verify email provider config in staging/production (S3).
3. Tune log filters to avoid INFO-level noise (S3).

## Rerun Commands
```bash
# Start stack
docker compose up -d

# Run truth scan
cd playwright
npx playwright test tests/ultra-truth-scan.spec.js --timeout=720000 --reporter=list

# View report
npx playwright show-report reports/html
```

## Notes
- No destructive actions were taken.
- No deletions were executed outside QA_TEST_* markers.
