# VPS Dual Deploy Runbook (V1 + V2)

## Objective
Run V1 and V2 on the same VPS with separate databases and independent subdomains.

## Non-Negotiables
- Separate compose projects:
  - `COMPOSE_PROJECT_NAME=zenops-v1`
  - `COMPOSE_PROJECT_NAME=zenops-v2`
- Separate Postgres volumes (never shared).
- No cross-DB SQL reads/writes.
- Cross-system integration only via API events and status endpoints.

## Recommended Hostnames
- `api.<domain>` -> V2 API
- `studio.<domain>` -> V2 Studio
- `app.<domain>` -> V2 Web
- `portal.<domain>` -> V2 Portal
- `api-v1.<domain>` -> V1 API
- `v1.<domain>` -> V1 frontend

## V2 Required Env
- `JWT_SECRET`
- `STUDIO_SERVICE_TOKEN` (service-to-service billing token)
- `STUDIO_ADMIN_TOKEN` (temporary emergency control-plane token)
- `CONTROL_RATE_LIMIT_RPM` (default `180`)
- `DATABASE_URL_API`, `DATABASE_URL_WORKER`, `DATABASE_URL_ROOT`
- `REDIS_URL`
- `PAYMENT_WEBHOOK_DEV_BYPASS` (`false` in VPS/prod)
- `STRIPE_WEBHOOK_SECRET` (when Stripe webhooks are enabled)
- `RAZORPAY_WEBHOOK_SECRET` (when Razorpay webhooks are enabled)
- `BILLING_API_BASE_URL` (worker -> API refill call, include `/v1` or bare API host)

## V1 Required Env
- `STUDIO_BASE_URL=https://api.<domain>`
- `STUDIO_SERVICE_TOKEN=<same token as V2>`
- `DEFAULT_BILLING_MODE=POSTPAID`
- `STUDIO_STATUS_CACHE_SECONDS=45`

## Migration Safety
- Use forward-only Prisma/schema updates.
- Do not drop volumes during deploy.
- Take DB backup before schema changes.

## Identity Checks
Before any smoke run, verify routing target:

```bash
curl -sS https://api.<domain>/v1/meta
curl -sS https://api-v1.<domain>/v1/meta
```

Expected:
- V2 meta returns `"app":"zenops-v2"`
- V1 meta returns `"app":"zenops-v1"`

## V2 Smoke
Run:

```bash
cd /Users/dr.156/ZenOpsV2
./scripts/smoke-v2.sh
./scripts/smoke-vps.sh
```

What it validates:
- API identity and health
- create/upsert billing account
- grant credits
- reserve credits
- release credits
- consume credits
- reconcile dry-run
- postpaid service invoice create -> issue -> mark-paid

## DNS/Subdomain Migration Safety
Subdomain moves do not require DB migration:
- update Traefik router labels / DNS records
- keep existing compose project + Postgres volume
- verify auth cookie domain/SameSite config if cookie auth is used

## Rollback
1. Repoint DNS/router to previous service.
2. Redeploy previous image tags.
3. Keep DB volumes intact (no destroy).
4. Re-run `/v1/meta` and smoke checks.

## Monthly Refill Operations
1. Worker queue `billing-subscription-refill` runs hourly.
2. Worker calls `POST /v1/billing/subscriptions/refill-due` using `x-service-token`.
3. If worker is paused, operator can run manual refill from Studio or:

```bash
curl -sS -X POST "https://api.<domain>/v1/control/subscriptions/<subscription_id>/refill" \
  -H "Authorization: Bearer <studio token>" \
  -H "Content-Type: application/json" \
  -d '{}'
```
