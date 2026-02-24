# M5.2 -> M5.3 Takeover Handoff

Last updated: 2026-02-24 (Asia/Kolkata)

## Branch and commit state
- V2 repo: `/Users/dr.156/ZenOpsV2`
- Current branch: `codex/m4-6-masterdata-lifecycle`
- Head before this handoff commit: `15f3656`
- Base branch target: `main`

## What is complete in this branch (V2)

### M5.1 (credits/subscriptions/postpaid parity groundwork)
- Billing truth spine in V2 Studio is operational:
  - billing accounts, policies, credits ledger, reservations, balances, timeline/events
  - service invoices (postpaid capability in V2, simple V1-style operational model)
  - onboarding + default POSTPAID policy flow
  - subscription assignment + refill paths
- V2 Studio UI expanded for operator workflows:
  - account billing mode controls
  - credit actions and visibility
  - invoices + subscriptions surfaces
- Worker scheduling in place for subscription refill scans / credit reconciliation.

Representative M5.1 commit stack on this branch:
- `cc509f7` `feat(db): extend subscription models for refill and webhook events`
- `490f597` `feat(rls): add subscription events to billing control policies`
- `773f47c` `feat(contracts): add m5.1 subscription, onboarding, and payment webhook routes`
- `ec3a910` `feat(api): add m5.1 subscriptions, onboarding, and webhook billing flows`
- `3637829` `feat(worker): schedule hourly subscription credit refills`
- `de769ce` `feat(ui): add credit enrollment guardrails in studio policy controls`
- `69dbaac` `test(m5.1): cover subscription refills and invoice payment idempotency`
- `48ac92a` `docs(m5.1): update credit rulebook and dual-vps runbook`
- `b5c987b` `chore(env|scripts): add dual-vps smoke workflow and idempotent invoice checks`

### M5.2 (payments rails + lifecycle automation + deploy hardening)
- Real payment rails scaffolding + settlement flow added:
  - `/v1/payments/checkout-link`
  - `/v1/payments/topup`
  - verified webhooks:
    - `/v1/payments/webhooks/stripe`
    - `/v1/payments/webhooks/razorpay`
- Webhook ingestion implemented with:
  - signature verification path (Stripe SDK verification + Razorpay HMAC)
  - dev-only bypass guard (`PAYMENT_WEBHOOK_DEV_BYPASS`, blocked in prod)
  - idempotent event ingestion via provider event id
  - settlement translation into internal billing actions (topup grants / invoice payment handling)
- Payment and subscription operator surfaces in Studio UI:
  - payments events/orders
  - subscriptions visibility and controls
- Worker hardened:
  - hourly subscription refill processing
  - hourly credit reconcile sweep integration
- VPS deploy hardening:
  - Traefik routes/middleware updates
  - webhook route coverage
  - smoke scripts expanded for payment + credit + invoice flow
- Tests added for:
  - webhook idempotency
  - worker sweeps / refill/reconcile behavior

M5.2 layered commit stack (exact order used):
- `d2be450` `feat(db): add payment rails schema and subscription lifecycle fields`
- `1538b7c` `feat(rls): add payment tables and expiry invariants to billing policies`
- `7474485` `feat(contracts): document m5.2 payment and control-plane monitoring endpoints`
- `ab90b48` `feat(api): add payment checkout and verified webhook settlement flows`
- `34834cb` `feat(worker): run hourly billing refill and credit reconcile sweep`
- `5aeeca6` `feat(ui): add payments and subscription operator surfaces`
- `8d4954f` `test(m5.2): cover payment webhook idempotency and worker sweeps`
- `d37e4ba` `docs(m5.2): document payment settlement, lifecycle ops, and smoke checks`
- `bf2d154` `chore(env|scripts): harden vps routing and payment smoke flows`

Follow-up branch hygiene/tooling commit:
- `15f3656` `chore(scripts): add docker compose validation command`

## Companion V1 rollout work completed (separate repo, already pushed)

V1 repo: `/Users/dr.156/zen-ops` on branch `ai/work`

### Billing handshake + credits awareness (already completed earlier)
- V1 Studio billing adapter added (V2 service-token handshake)
- V1 emits billing events to V2 timeline
- V1 soft-gating for credit mode on commission approval flows
- Docker/deploy safety improvements

Representative recent V1 commits:
- `bcdcbc1` `feat(billing): add studio handshake adapter, events, and docker-safe startup`
- `93a74b1` `feat(billing-ui): add credit visibility cache and soft-gating in approvals`
- `2daea12` `feat(events): emit commission_cancelled and credit release on commission rejection`

### V1 Billing Monitor page (monitor-only)
- Added admin-only `Billing Monitor` page showing:
  - V1 invoices/payments (operational postpaid truth)
  - V2 billing mode/credits/timeline (read-only)
  - adapter connectivity/cache status + fail-open indicators
- Backend endpoints:
  - `GET /v1/admin/billing-monitor/summary`
  - `GET /v1/admin/billing-monitor/account/{external_key}`
- TTL caching and fail-open behavior retained in adapter (`STUDIO_STATUS_CACHE_SECONDS`)

V1 commits:
- `0f9cd07` `feat(v1): add billing monitor page for payments + credit visibility`
- `c1b3d78` `chore(v1): add docker compose validation script`

## Validation and test results completed so far

### V2 validations (completed and passing)
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm contract_check`
- `docker compose --env-file .env.prod -f infra/docker/compose.vps.yml config -q` (validated previously)
- `pnpm docker:test` (new compose validation command)

### V1 validations (completed and passing unless noted)
- `python -m compileall backend/app`
- `PYTHONPATH=backend pytest backend/tests/test_studio_billing_adapter.py` (3 passed)
- `cd frontend && npm run build`
- `docker compose -f docker-compose.hostinger.yml config -q`
- `bash scripts/docker-test.sh`

Known local environment test gap in V1:
- `PYTHONPATH=backend pytest backend/tests/test_invoices.py ...` failed in this machine session due missing Python dependency `prometheus_client` in local interpreter (not a code regression signal in the changed monitor feature).

## Container rebuild + runtime verification (latest session)

### V1 rebuild/test
- Rebuilt and restarted V1 stack:
  - `docker compose -f docker-compose.yml up -d --build`
- Verified:
  - `docker compose -f docker-compose.yml ps` (api/email-worker/frontend healthy)
  - container-internal API checks:
    - `/v1/meta` -> 200
    - `/healthz` -> 200

Notes:
- Root reverse-proxy path probing at `http://localhost/api/v1/meta` returned 404 in this local setup; direct in-container API checks were used as truth.
- `zen-ops-watchdog-1` remained unhealthy (pre-existing, unrelated to billing changes).

### V2 rebuild/test (dev compose, non-conflicting local ports)
- Used alternate bind ports to avoid local collisions on `5432` and `3000`.
- Command used:

```bash
COMPOSE_PROJECT_NAME=zenopsv2-rebuild \
POSTGRES_BIND_PORT=65432 \
REDIS_BIND_PORT=56380 \
API_BIND_PORT=3300 \
WEB_BIND_PORT=5273 \
STUDIO_BIND_PORT=5274 \
PORTAL_BIND_PORT=5275 \
docker compose -f infra/docker/compose.dev.yml up -d --build
```

- Verified:
  - `http://localhost:3300/v1/meta` -> 200 (`zenops-v2`)
  - `http://localhost:3300/v1/health` -> 200
  - `http://localhost:5273/` -> 200 (web)
  - `http://localhost:5274/` -> 200 (studio)
  - `http://localhost:5275/` -> 200 (portal)

## New M5.3 anchor included in this handoff commit

- `/Users/dr.156/ZenOpsV2/docs/ZENOPS_REPORT_GENERATION_REQUIREMENTS.md`

Purpose:
- This is the M5.3 requirements anchor for the in-house report generation framework (valuation/DPR/stage-progress/TEV).
- It captures template families, formulas, OCR/upload-first workflow, annexures, and output constraints discussed in the planning session.

This file should be treated as:
- product requirements source for M5.3 scope slicing
- implementation reference for template/rules/evidence architecture
- acceptance criteria seed for report generator milestones

## Suggested immediate next step (M5.3 execution)

1. Convert `ZENOPS_REPORT_GENERATION_REQUIREMENTS.md` into an implementable M5.3 plan with layered commits:
   - db/data model for report templates + report packs + evidence links
   - contracts (report generation endpoints)
   - API/services (template registry, generation jobs)
   - worker (docx/pdf generation pipeline)
   - UI (upload-first report assembly + OCR review)
   - tests/docs/smoke
2. Start with a single template family end-to-end:
   - `SBI_UNDER_5CR_V1` + annexures pack generation
3. Keep billing spine untouched and consume existing assignment/evidence/billing truth services.

## Continuation commands

```bash
cd /Users/dr.156/ZenOpsV2
git checkout codex/m4-6-masterdata-lifecycle
git pull --rebase
pnpm docker:test
pnpm lint
pnpm test
pnpm contract_check
pnpm build
```

Optional local dev stack (alternate ports to coexist with V1):

```bash
COMPOSE_PROJECT_NAME=zenopsv2-rebuild \
POSTGRES_BIND_PORT=65432 \
REDIS_BIND_PORT=56380 \
API_BIND_PORT=3300 \
WEB_BIND_PORT=5273 \
STUDIO_BIND_PORT=5274 \
PORTAL_BIND_PORT=5275 \
docker compose -f infra/docker/compose.dev.yml up -d --build
```

