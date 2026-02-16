# CREDIT SYSTEM RULEBOOK (V2 AUTHORITATIVE)

## Scope
This is the billing truth contract for ZenOps V2 Studio.

- V2 owns: policy, wallet, reservations, credit ledger, and billing timeline events.
- V1 remains the operational postpaid engine at launch, but must handshake with V2 via APIs.
- No cross-database SQL writes between V1 and V2.

## Billing Modes
- `POSTPAID` (default): normal invoicing path.
- `CREDIT`: reserve/consume/release path for commissioned work.

Defaults applied for new billing policies:
- `billing_mode=POSTPAID`
- `payment_terms_days=15`
- `credit_cost_model=flat_1_per_report`
- `currency=INR`
- `is_enabled=true`

## External Key Convention
Billing account `external_key` must be stable and match one of:
- `v1:partner:{partner_id}`
- `v1:client:{client_id}`
- `v1:assignment:{assignment_id}`
- `v1:invoice:{invoice_id}`
- `v2:tenant:{tenant_id}`
- `v2:external:{external_associate_id}`

## Credit Lifecycle
State machine:
- `ACTIVE -> CONSUMED`
- `ACTIVE -> RELEASED`
- No `CONSUMED -> RELEASED`
- No `RELEASED -> CONSUMED`

Operations:
1. `reserve`: requires sufficient available credits unless operator override is explicitly set.
2. `consume`: final spend; moves reserved -> spent.
3. `release`: returns reserved capacity to available.

## Balance Invariants
V2 maintains `wallet`, `reserved`, `available` with invariant:
- `wallet >= 0`
- `reserved >= 0`
- `available >= 0`
- `available = wallet - reserved`

The `billing_credit_balances` table enforces this invariant with a DB check constraint.
All mutation operations lock the account and balance row before applying updates.

## Idempotency Rules
Every side-effect write must include `idempotency_key`.
Required for:
- credit grant/topup/adjustment
- reserve/consume/release
- subscription refill events
- billing event ingestion
- invoice issue/remind/payment-related side effects (`mark-paid` retries reuse the same key)

Duplicate idempotency keys must not create duplicate financial effects.

## Subscriptions and Monthly Refill
V2 subscription tables (`subscription_plans`, `tenant_subscriptions`, `subscription_events`) drive scheduled credit grants.

- Refill worker cadence: hourly.
- Due criteria: `status=ACTIVE` and `next_refill_at <= now`.
- Refill key format: `refill:{subscription_id}:{period_start_iso}`.
- Refill path: same invariant-safe grant path used by manual credit grants.
- Refill writes:
  - ledger entry (`reason=GRANT`, `ref_type=subscription_refill`)
  - timeline usage event
  - subscription event row (`credits_refilled`)
  - period advancement (`current_period_start`, `current_period_end`, `next_refill_at`).
- Lifecycle transitions:
  - `active` -> `past_due` when period closes without payment.
  - `past_due` -> `suspended` after grace window.
  - `past_due|suspended` -> `active` on payment/reactivation signals.

Duplicate refill attempts for the same key must be no-op.

## Payment Settlement Rules (Money -> Billing Truth)
Checkout and topup creation endpoints:
- `POST /v1/payments/checkout-link`
- `POST /v1/payments/topup`

Webhook ingress endpoints:
- `POST /v1/payments/webhooks/stripe`
- `POST /v1/payments/webhooks/razorpay`

Rules:
- Signature verification is mandatory in non-dev environments.
  - Stripe uses raw-body verification with `STRIPE_WEBHOOK_SECRET`.
  - Razorpay validates `X-Razorpay-Signature` HMAC with `RAZORPAY_WEBHOOK_SECRET`.
- `PAYMENT_WEBHOOK_DEV_BYPASS=true` is allowed only for local/dev smoke testing.
- Every accepted webhook is persisted in `payment_events` with `signature_ok`, `payload_hash`, provider `event_id`, and processing timestamp.
- Duplicate webhook deliveries are deduplicated by `(provider, event_id)` and must never re-apply side effects.
- Settlement actions:
  - `purpose=TOPUP` + paid event -> grant credits through the same invariant-safe ledger path as manual grants.
  - `purpose=INVOICE` + paid event -> mark invoice paid through idempotent invoice payment path.

## Real Work Triggers
V2-native channel request flow wiring:
- On accept:
  - mode `CREDIT` -> reserve 1 credit
  - mode `POSTPAID` -> create/issue service invoice path
- On deliverable release:
  - consume reservation when present
- On cancel/reject:
  - release reservation when present

## Studio Operator Controls
Studio control-plane supports:
- account search + policy switching
- grant credits
- reserve/consume/release
- reconciliation sweep (`POST /v1/control/credits/reconcile`, supports dry-run)
- ledger view (last events)
- reservations view (active/consumed/released)
- billing timeline (credits + usage + invoice state)
- service invoices (create/issue/mark-paid)
- subscriptions (create/pause/resume/cancel/manual refill)
- onboarding endpoint that creates tenant + default POSTPAID billing account

## Onboarding Defaults
For every new billing account created through Studio onboarding:
- `billing_mode=POSTPAID`
- `is_enabled=true`
- `wallet=0`
- `reserved=0`
- `available=0`

Credit mode should be enabled only when the operator confirms readiness and funding.

## Launch Guidance
- Start new customers in `POSTPAID`.
- Flip individual accounts to `CREDIT` from Studio when policy and top-up operations are ready.
- Use the timeline for dispute/debug traces across V1 and V2 events.
