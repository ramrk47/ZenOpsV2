# V1 -> V2 Billing Handshake

## Purpose
V1 remains the operational billing engine for early postpaid customers, while V2 Studio is the billing control-plane source of truth.

This document defines the current integration contract from V1 (`/Users/dr.156/zen-ops`) to V2 (`/Users/dr.156/ZenOpsV2`).

## V1 Configuration
Set these backend environment variables:

- `STUDIO_BASE_URL` (example `https://api-zenops.notalonestudios.com`)
- `STUDIO_SERVICE_TOKEN`
- `DEFAULT_BILLING_MODE=POSTPAID` (fallback when Studio is unreachable)
- `STUDIO_HTTP_TIMEOUT_SECONDS=5`
- `STUDIO_STATUS_CACHE_SECONDS=45` (short-lived status cache to reduce control-plane load)

## Adapter
V1 implements `StudioBillingAdapter` at:

- `/Users/dr.156/zen-ops/backend/app/services/studio_billing.py`

Supported methods:

- `get_billing_status(account_key)`
- `reserve_credits(...)`
- `consume_credits(...)`
- `release_credits(...)`
- `emit_event(...)`

All adapter calls are fail-open for V1 continuity (errors are logged, core V1 flow is not blocked).

## Account Mapping Strategy (Chosen)
V1 sends **stable external account keys** to V2 instead of cross-DB IDs.

Priority:

1. `v1:partner:{partner_id}` (commissioned work path, preferred)
2. `v1:client:{client_id}`
3. `v1:assignment:{assignment_id}`
4. `v1:invoice:{invoice_id}`

This avoids cross-write coupling and keeps V1/V2 databases independent.

## Events Emitted by V1
V1 now emits billing events to `POST /v1/billing/events` in V2 for:

- `invoice_created`
- `invoice_issued`
- `invoice_sent`
- `payment_recorded`
- `invoice_paid`
- `invoice_voided`
- `work_accepted`
- `commission_cancelled`
- `deliverables_released` (optional flow)

Payload includes stable identifiers and billing facts such as:

- `invoice_id`, `invoice_number`
- `assignment_id`
- `amounts` (`total_amount`, `amount_paid`, `amount_due`, `amount_credited`)
- `timestamps` (`issued_date`, `due_date`, `sent_at`, `paid_at`)
- `payment` details for payment events

Every event includes an idempotency key.

## Credit Flow (When Commissioning is CREDIT Mode)
For V1 commission intake:

1. On commission approval (`work_accepted`), V1 checks billing status and attempts `reserve_credits`.
2. On deliverable release, V1 attempts `consume_credits`.

If account policy is postpaid, reserve/consume calls are safely ignored by V2 policy checks.

## Internal Visibility in V1 (Current)
- Admin external approvals now display billing mode and credit availability for each open commission.
- CREDIT-mode commissions with no available credits are soft-gated at approval time.
