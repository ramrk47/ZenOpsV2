# Phase 6: External Associate Self-Onboarding

This document describes the V1 self-serve onboarding flow for External Associates (`EXTERNAL_PARTNER`) in `legacy/v1`.

## Onboarding Modes

Configure with `ASSOCIATE_ONBOARDING_MODE`:

- `INVITE_ONLY`
  - Public request-access is blocked.
  - Admin invite flow remains available.
- `REQUEST_ACCESS_REVIEW`
  - Public request-access enabled.
  - Email verification required by default.
  - Verified requests move to admin review queue.
- `REQUEST_ACCESS_AUTO_APPROVE`
  - Public request-access enabled.
  - Email verification required by default.
  - Verified requests are auto-provisioned when policy checks pass.

Related settings:

- `ASSOCIATE_EMAIL_VERIFY_REQUIRED=1`
- `ASSOCIATE_VERIFY_TOKEN_TTL_MINUTES=15`
- `ASSOCIATE_AUTO_APPROVE_DOMAINS` (optional comma-separated allowlist)
- `ASSOCIATE_AUTO_APPROVE_MAX_PER_DAY`

## Public Flow

1. `POST /api/partner/request-access`
   - Creates `partner_account_requests` row.
   - Status starts as `PENDING_EMAIL_VERIFY` (when verification required).
   - Queues verification email with one-time token.
2. `POST /api/partner/verify-access-token`
   - Consumes one-time token.
   - If auto-approve mode: provisions associate user + partner profile.
   - Else: transitions to `VERIFIED_PENDING_REVIEW`.
3. Admin review (review mode):
   - `POST /api/admin/associate-access-requests/{id}/approve`
   - `POST /api/admin/associate-access-requests/{id}/reject`

Backward-compatible route retained:

- `POST /api/partner/verify` (legacy alias to `verify-access-token`)

Optional helper endpoint:

- `POST /api/partner/resend-verification`

## Data Model

`partner_account_requests` now includes:

- `city`, `role_intent`, `requested_interface`, `metadata_json`
- `token_expires_at`, `token_consumed_at`
- `approved_at`

## Security Baseline

- One-time verification tokens are stored hashed (`email_verification_token`).
- Tokens expire (`ASSOCIATE_VERIFY_TOKEN_TTL_MINUTES`) and cannot be reused.
- Request, resend, and verify paths are rate-limited via DB buckets.
- Associate route isolation is enforced by backend path guards.

## Verification

```bash
cd legacy/v1
docker compose -f docker-compose.dev.yml run --rm backend alembic upgrade head
docker compose -f docker-compose.dev.yml run --rm backend pytest -q tests/test_phase6_onboarding.py
cd frontend && npm run build
```
