# CREDIT SYSTEM RULEBOOK (V1 <-> V2)

## Purpose
Define the minimal, enforceable operating rules while V1 stays the operational postpaid billing engine and V2 Studio owns credit truth.

## Ownership Boundary
- V1 (`/Users/dr.156/zen-ops`) owns operational invoicing for early launch postpaid customers.
- V2 (`/Users/dr.156/ZenOpsV2`) owns credit policy, credit ledger, reservations, and billing event truth.
- Databases remain separate. No cross-DB SQL writes.

## Billing Modes
- `POSTPAID`: default launch mode.
- `CREDIT`: enabled per account in V2 Studio.
- V1 reads mode from V2 via `StudioBillingAdapter.get_billing_status()`.

## Account Mapping
V1 resolves stable external keys and sends them to V2:
1. `v1:partner:{partner_id}`
2. `v1:client:{client_id}`
3. `v1:assignment:{assignment_id}`
4. `v1:invoice:{invoice_id}`

## Credit Lifecycle (Commissioned Work)
1. `RESERVE` on commission acceptance when billing mode is `CREDIT`.
2. `CONSUME` on deliverable release.
3. `RELEASE` when commission is cancelled/rejected or otherwise not fulfilled.

## Idempotency Rules
- Every financial side-effect call must include an idempotency key.
- Retry-safe behavior is required for:
  - reserve
  - consume
  - release
  - event emission
- Duplicate keys must not create duplicate financial effects.

## V1 Internal UX (Current Scope)
- V1 admin commission inbox shows:
  - billing mode (`POSTPAID` or `CREDIT`)
  - available credits for credit-mode accounts
- Soft gate: approve action is blocked only when mode is `CREDIT` and available credits are `0`.
- Postpaid flow remains unaffected.

## Caching and Reliability
- V1 caches billing status lookups for a short TTL (`STUDIO_STATUS_CACHE_SECONDS`, default `45`).
- On V2/API errors, V1 fails open with safe default mode (`DEFAULT_BILLING_MODE=POSTPAID`) to preserve operations.

## Launch Guidance
- Keep new customers on `POSTPAID` first.
- Flip to `CREDIT` per account in V2 Studio once credit policies and top-up operations are stable.
- Reconcile V1 emitted billing events in V2 timeline during rollout.
