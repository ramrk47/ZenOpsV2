# Billing Monitor Guide (V1)

## Purpose
`Billing Monitor` is a read-only admin page in V1 that merges:
- V1 operational postpaid activity (invoices + payments)
- V2 Studio credit truth (billing mode, balances, reservations, ledger, timeline)

Path:
- UI: `/admin/billing-monitor`
- API summary: `GET /v1/admin/billing-monitor/summary`
- API detail: `GET /v1/admin/billing-monitor/account/{external_key}`

## What the Page Shows
1. Connectivity + identity
- V1 identity/version/environment
- configured Studio base URL
- Studio `/v1/meta` summary when reachable
- last successful Studio fetch and cache age

2. Account billing summary
- Referral Channel and client records with stable mapping key (`external_key`)
- billing mode (`POSTPAID` or `CREDIT`)
- wallet/reserved/available credits
- warning badges (for example, `insufficient_credits`)

3. V1 financial truth
- last 30 invoices
- last 30 payments

4. V2 credit activity (read-only)
- reservations
- ledger rows
- timeline rows

## Mapping Rules
V1 maps entities to stable V2 keys:
- Referral Channel / external associate: `v1:partner:{id}`
- Client: `v1:client:{id}`
- Fallbacks (if needed): `v1:assignment:{id}`, `v1:invoice:{id}`

Use **Copy external_key** to troubleshoot quickly in V2 Studio.

## Caching + Fail-Open Behavior
- V2 lookups are cached in memory with `STUDIO_STATUS_CACHE_SECONDS` (default `45`).
- `Refresh now` forces a cache bypass for that request, with lightweight rate-limiting.
- If V2 is unreachable:
  - monitor shows last cached data when available
  - banner appears: `Studio unavailable, showing cached data`
  - V1 operational default mode remains `POSTPAID` (fail-open policy)

## How to Test
1. Open V1 Billing Monitor and confirm V1 invoices/payments render.
2. In V2 Studio, enroll one account in `CREDIT` mode and grant credits.
3. Back in V1 Billing Monitor, click `Refresh now`.
4. Verify account row shows `CREDIT` and non-zero available credits.
5. Trigger a commission lifecycle event (accept/deliver/cancel path) and re-check:
- reservation appears in V2 section
- ledger/timeline entries update

## Common Failure Modes
1. Studio down/unreachable:
- monitor still loads V1 data
- V2 section shows cached or empty rows with warning state

2. Missing mapping key:
- account shows fallback `POSTPAID`
- warning includes `not_enrolled` or `studio_unreachable`

3. Stale cache confusion:
- use `Refresh now` and wait for cooldown if rate-limited.
