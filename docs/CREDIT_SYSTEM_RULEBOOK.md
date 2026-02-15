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
- billing event ingestion
- invoice issue/remind/payment-related side effects

Duplicate idempotency keys must not create duplicate financial effects.

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
- ledger view (last events)
- reservations view (active/consumed/released)
- billing timeline (credits + usage + invoice state)
- service invoices (create/issue/mark-paid)

## Launch Guidance
- Start new customers in `POSTPAID`.
- Flip individual accounts to `CREDIT` from Studio when policy and top-up operations are ready.
- Use the timeline for dispute/debug traces across V1 and V2 events.
