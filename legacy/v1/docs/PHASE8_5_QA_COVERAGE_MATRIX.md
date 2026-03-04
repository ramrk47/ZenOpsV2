# Phase 8.5 QA Coverage Matrix

## Suites

| Suite | File | Primary Roles | Coverage |
|---|---|---|---|
| DOM crawler | `frontend/playwright/tests/zz_dom_crawler.spec.ts` | Admin | Visits primary routes, clicks visible controls safely, traps console/page/network/HTTP errors, emits crawler JSON report. |
| Core workflows | `frontend/playwright/tests/assignments.spec.ts` | Admin, Field Valuer | Assignment create/edit/delete path, tasks, chat, docs upload, final-review trigger, draft-only guard for field role, admin-only master data restriction. |
| Approvals | `frontend/playwright/tests/approvals.spec.ts` | Admin, Field Valuer | Draft approval/rejection, final document review approval, payment confirmation approval, non-admin approvals page restriction. |
| Invoices | `frontend/playwright/tests/invoices.spec.ts` | Admin/Finance-capable paths | Payment mode invariants, card rejection, notes rule for `OTHER`, adjustments impact, CSV export column invariants, approval-driven totals change. |
| Master data | `frontend/playwright/tests/masterdata.spec.ts` | Admin, Associate | Service-line CRUD + policy JSON update, document template CRUD, associate forbidden from master data surface/API. |
| Associate onboarding + multi-account | `frontend/playwright/tests/associate_onboarding.spec.ts` | Anonymous, Associate, Admin | Public request-access submission, associate login/use, cross-account partner request/response loop, commission approval + completion, associate access restrictions. |
| Chaos/tinker | `frontend/playwright/tests/chaos.spec.ts` | Admin | Random assignment edit/reload persistence loop, rapid navigation stress, silent-failure capture through global traps. |

## Workflow checklist mapping

| Workflow | Covered by |
|---|---|
| Create/edit/delete assignments | `assignments.spec.ts`, `chaos.spec.ts` |
| Draft assignment approval flow | `assignments.spec.ts`, `approvals.spec.ts` |
| Final document review approval | `assignments.spec.ts`, `approvals.spec.ts` |
| Payment confirmation approval | `approvals.spec.ts`, `invoices.spec.ts` |
| Invoice adjustments + analytics/export invariants | `invoices.spec.ts` |
| Master data CRUD + service-line policies + doc templates | `masterdata.spec.ts` |
| Associate onboarding self-serve + partner portal actions | `associate_onboarding.spec.ts` |
| RBAC forbidden actions | `assignments.spec.ts`, `approvals.spec.ts`, `masterdata.spec.ts`, `associate_onboarding.spec.ts` |
| Silent failures (console/network/4xx/5xx) | Global trap fixture in all suites + crawler report |

## Page coverage map (primary routes)

| Route area | Coverage source |
|---|---|
| `/login`, `/partner/request-access`, `/partner/*` | `associate_onboarding.spec.ts`, `zz_dom_crawler.spec.ts` |
| `/assignments`, `/assignments/new`, `/assignments/:id` | `assignments.spec.ts`, `chaos.spec.ts`, `zz_dom_crawler.spec.ts` |
| `/invoices` | `invoices.spec.ts`, `zz_dom_crawler.spec.ts` |
| `/requests` | `chaos.spec.ts`, `zz_dom_crawler.spec.ts` |
| `/calendar`, `/notifications` | `chaos.spec.ts`, `zz_dom_crawler.spec.ts` |
| `/admin/approvals` | `approvals.spec.ts`, `chaos.spec.ts`, `zz_dom_crawler.spec.ts` |
| `/admin/masterdata` | `masterdata.spec.ts`, `zz_dom_crawler.spec.ts` |
| `/admin/personnel`, `/admin/dashboard`, `/admin/* core` | `chaos.spec.ts`, `zz_dom_crawler.spec.ts` |

## Destructive toggle policy
- Default crawler mode is non-destructive.
- `E2E_DESTRUCTIVE=1` enables destructive click attempts in crawler.
- Keep `E2E_DESTRUCTIVE=0` in CI/pilot smoke unless explicitly validating destructive paths.
