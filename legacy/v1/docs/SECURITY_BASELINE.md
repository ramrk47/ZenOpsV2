# Security Baseline (Phase 8)

## Environment Baseline

Required in production:
- `ENVIRONMENT=production`
- `ALLOW_ORIGINS` must be explicit list, never `*`
- `JWT_SECRET` must be long random string (32+ chars)
- `UPLOADS_DIR=/app/uploads`
- `PUBLIC_BASE_URL=https://<production-domain>`
- DB pool tuning set (`DB_POOL_SIZE`, `DB_MAX_OVERFLOW`)
- rate limits configured (`RATE_LIMIT_*` values)

## API Security Controls

- Strict origin enforcement in production when `Origin` header is present.
- CORS credentials enabled only for allowlisted origins.
- Security headers on API responses:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: no-referrer`
  - `Permissions-Policy` with minimal denies
  - `Content-Security-Policy-Report-Only` (safe rollout mode)

## Authentication Abuse Controls

DB-backed rate limiting (no Redis dependency) for:
- `/api/auth/login`
- `/api/partner/request-access`
- password reset endpoints

On violation:
- HTTP `429`
- response detail includes `RATE_LIMITED`
- security event added to activity log

## Upload Hardening

- size limit via `MAX_UPLOAD_MB` (default 25)
- explicit MIME/extension allowlist
- block suspicious double extensions (`.pdf.exe`, etc.)
- sanitized filenames + UUID storage names
- path traversal protection (resolved path must remain inside uploads root)
- atomic write (`temp -> fsync -> rename`)
- optional AV hook (`AV_SCAN_ENABLED=1`, currently placeholder)

## Deployment Safety Controls

`ops/deploy.sh` enforces:
- env + origin preflight
- DB reachability check
- uploads dir writability
- mandatory backup in production before migrations
- readiness and smoke gate before success

## Header Tuning Guidance

If embedding is required in future, change:
- `X-Frame-Options: DENY` -> `SAMEORIGIN`

If CSP causes false positives:
- keep `Content-Security-Policy-Report-Only` first
- tighten to enforced CSP only after browser report review
