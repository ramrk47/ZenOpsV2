# Phase Pilot Mode (V1 Only)

## Purpose
- Lock V1 into a stable pilot-safe feature set.
- Keep deployment and operations predictable on a single VPS behind Traefik.
- Hide or hard-disable non-critical incomplete integrations during pilot.

## Non-Negotiables
- `legacy/v1` remains the only deployed app surface.
- No V2/Repogen dependency required in pilot mode.
- Critical routes remain available: `/healthz`, `/readyz`, `/version`, login, assignments, requests, invoices.

## Pilot Flags
- Backend (`.env.backend`):
  - `PILOT_MODE=1`
  - `ADMIN_MASTER_KEY=<strong random secret>`
  - `ASSOCIATE_EMAIL_MODE=email|disabled`
- Frontend build (`.env` used by compose build args):
  - `VITE_PILOT_MODE=1`
  - `VITE_ENABLE_REPOGEN_INPUTS=0`

## Feature Gating Behavior
- When `PILOT_MODE=1`:
  - Billing Monitor UI is hidden from admin sidebar.
  - `/admin/billing-monitor` route is blocked in frontend (Forbidden view).
  - Backend billing monitor endpoints return `403`:
    - `code: FEATURE_DISABLED_IN_PILOT`
    - `feature: billing_monitor`
  - Forecast v2 experimental API is blocked in backend with the same code pattern.
  - Repogen placeholder input panel in Assignment Detail is hidden even if assignment JSON has repogen blobs.

## Associate Email Delivery Modes
- `ASSOCIATE_EMAIL_MODE=email`:
  - Normal onboarding email flow (verification + resend) via email queue.
  - `email-worker` should run.
- `ASSOCIATE_EMAIL_MODE=disabled`:
  - Non-production fallback only (forced back to `email` in production).
  - Verification emails are not queued.
  - If `ASSOCIATE_AUTO_APPROVE=1` and environment is non-production, request-access response includes one-time `debug_verify_url`.
  - UI shows a “Copy verification link” helper on request-sent screen only when backend sends that URL.

## Admin Master Key (User Create/Reset)
- `ADMIN_MASTER_KEY` enables an admin-only fallback for user-account creation and password reset actions.
- Scope is limited to user create/reset endpoints; other step-up routes continue to require normal authenticator step-up.
- UI step-up prompt accepts either:
  - a 6-digit authenticator code, or
  - the admin master key (for user create/reset flows).

## Clean Pilot Reset (Data + Admin Bootstrap)
Use this when you want a clean pilot state (remove demo assignments/data and recreate admin users only):

```bash
cd /opt/zenops/ZenOpsV2/legacy/v1
./ops/reset_pilot_clean.sh \
  --admin "admin1@example.com:ReplacePassword1!" \
  --admin "admin2@example.com:ReplacePassword2!"
```

What it does:
- Runs migrations (schema-safe).
- Truncates all public tables except `alembic_version`.
- Seeds baseline master data only (no dummy assignment payloads).
- Creates the specified admin accounts with MFA disabled.

## Deploy Commands (Pilot)
```bash
cd /opt/zenops/ZenOpsV2/legacy/v1

# 1) Diagnose Traefik + routing quickly
./ops/diag_traefik_v1.sh

# 2) Deploy (hostinger compose + pilot overlay)
./ops/deploy_pilot_v1.sh
```

## Direct Compose Equivalent
```bash
docker compose -p zenops -f docker-compose.hostinger.yml -f docker-compose.pilot.yml up -d db uploads-perms
docker compose -p zenops -f docker-compose.hostinger.yml -f docker-compose.pilot.yml run --rm migrate
docker compose -p zenops -f docker-compose.hostinger.yml -f docker-compose.pilot.yml up -d api email-worker frontend
```

## Expected Route Checks
- `curl -I -H "Host: zenops.notalonestudios.com" http://127.0.0.1/`
- `curl -s -H "Host: zenops.notalonestudios.com" http://127.0.0.1/healthz`
- `curl -s -H "Host: zenops.notalonestudios.com" http://127.0.0.1/readyz`
- `curl -s -H "Host: zenops.notalonestudios.com" http://127.0.0.1/version`
