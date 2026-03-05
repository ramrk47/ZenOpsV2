# Phase Deploy: V1 + Repogen Slice (Deployment-Only)

## Purpose
Deploy V1 (pilot RC) as primary system and run Repogen as an isolated sidecar slice for pilot operations, without refactoring V1 core or V2 code.

## Selected End State
- Selected path: **Path 2 (safe fallback for this RC snapshot)**.
- Reason: current RC snapshot includes bridge settings/schema placeholders but does not include a live V1 `/api/auth/bridge-token` route handler.
- Outcome: V1 and Repogen are deployed together; Repogen is reachable via `repogen.<domain>`, and smoke verifies authenticated Repogen API access.

## Files Added
- `legacy/v1/docker-compose.repogen.yml`
- `legacy/v1/deploy/repogen.env.example`
- `legacy/v1/ops/smoke_deploy_repogen.sh`

## DNS Requirements
Create records:
- `v1.<domain>` -> VPS public IP
- `repogen.<domain>` -> VPS public IP

## Required Ports
- `80/tcp` and `443/tcp` (reverse proxy)
- Internal app ports used by compose:
  - V1 API: `8000`
  - V1 Frontend: `80` (container), proxied
  - Repogen API: `3000`
  - Repogen Web: `5174`

## Environment Setup
1. Copy the template:
   - `cp legacy/v1/deploy/repogen.env.example legacy/v1/.env.repogen`
2. Set strong secrets and production values:
   - `REPOGEN_JWT_SECRET`
   - `REPOGEN_S3_ENDPOINT`
   - `REPOGEN_S3_BUCKET`
   - `REPOGEN_S3_ACCESS_KEY_ID`
   - `REPOGEN_S3_SECRET_ACCESS_KEY`
3. For Hostinger + shared Traefik network:
   - `TRAEFIK_NETWORK=traefik-proxy`
   - `TRAEFIK_NETWORK_EXTERNAL=true`
   - `REPOGEN_DOMAIN=repogen.<domain>`
   - `REPOGEN_PUBLIC_API_BASE_URL=https://repogen.<domain>/v1`

### Fast Path (no manual file editing)
From `legacy/v1`:

```bash
# Auto-generate .env, .env.backend, deploy/repogen.env
# Defaults:
#   V1_DOMAIN=zenops.notalonestudios.com
#   REPOGEN_DOMAIN=app-zenops.notalonestudios.com
./ops/bootstrap_pilot_env.sh --force

# Optional override in one line:
# V1_DOMAIN=zenops.notalonestudios.com \
# REPOGEN_DOMAIN=app-zenops.notalonestudios.com \
# REPOGEN_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
# REPOGEN_S3_BUCKET=<bucket> \
# REPOGEN_S3_ACCESS_KEY_ID=<key> \
# REPOGEN_S3_SECRET_ACCESS_KEY=<secret> \
# ./ops/bootstrap_pilot_env.sh --force

# Bring up stack in safe order (db -> migrate -> app -> repogen)
./ops/up_pilot_hostinger.sh
```

## Deploy Commands
From `legacy/v1`:

1. Start/refresh V1 services:
```bash
docker compose -f docker-compose.hostinger.yml up -d db uploads-perms migrate api email-worker frontend
```

2. Start Repogen slice:
```bash
docker compose \
  --env-file .env.repogen \
  -f docker-compose.repogen.yml \
  --profile repogen-slice up -d
```

3. Run smoke gates:
```bash
V1_BASE_URL=https://v1.<domain> \
REPOGEN_BASE_URL=https://repogen.<domain> \
REPOGEN_WEB_URL=https://repogen.<domain> \
V1_ADMIN_EMAIL=<admin_email> \
V1_ADMIN_PASSWORD=<admin_password> \
./ops/smoke_deploy_repogen.sh
```

### Smoke Script Environment Variables
- Required in full mode:
  - `V1_BASE_URL`
  - `V1_ADMIN_EMAIL`
  - `V1_ADMIN_PASSWORD`
  - `REPOGEN_BASE_URL`
  - `REPOGEN_WEB_URL`
- Optional:
  - `REPOGEN_INTERNAL_TENANT_ID`
  - `REPOGEN_BRIDGE_USER_ID`
  - `REPOGEN_BRIDGE_CAPABILITIES_JSON`
  - `REPOGEN_BRIDGE_EXCHANGE_PATH`
- Troubleshooting mode:
  - `SMOKE_SKIP_V1=1` skips V1 checks and validates Repogen health/auth only.

### PASS Output Example
```text
[smoke-repogen] Checking Repogen API/Web health
[smoke-repogen] Skipping V1 checks/auth because SMOKE_SKIP_V1=1
[smoke-repogen] Validating Repogen protected endpoint
[smoke-repogen] PASS: V1 + Repogen deployment smoke checks succeeded
```

## Local Validation (single host)
From `legacy/v1`:
```bash
docker compose -f docker-compose.dev.yml up -d db backend email-worker frontend

docker compose \
  -f docker-compose.dev.yml \
  -f docker-compose.repogen.yml \
  --profile repogen-slice up -d

./ops/smoke_deploy_repogen.sh
```

## Traefik Routing Notes
`docker-compose.repogen.yml` includes labels for:
- `repogen-web`: `Host(repogen.<domain>)`
- `repogen-api`: `Host(repogen.<domain>) && PathPrefix(/v1 or /docs)`

If your proxy is managed outside this compose, route:
- `repogen.<domain>` to `repogen-web:5174`
- `repogen.<domain>/v1*` to `repogen-api:3000`

## Backup and Restore Expectations
- V1 DB backups continue via existing V1 backup workflow (`ops/backup_now.sh`, `ops/restore.sh`, `ops/restore_drill.sh`).
- Repogen DB is isolated (`repogen-db`) and must be backed up separately:
```bash
docker exec -t <repogen-db-container> pg_dump -U ${REPOGEN_POSTGRES_USER:-postgres} ${REPOGEN_POSTGRES_DB:-zenops} > repogen_backup.sql
```
- Repogen artifacts should live in R2 for pilot prod (`REPOGEN_STORAGE_DRIVER=s3`).

## Rollback
1. Roll back V1 using existing script:
```bash
./ops/rollback.sh
```
2. Stop Repogen slice:
```bash
docker compose --env-file .env.repogen -f docker-compose.repogen.yml --profile repogen-slice down
```
3. If needed, restore repogen DB dump and restart slice.

## Known Limitation (RC Snapshot)
- V1 bridge-token API is not wired in this RC commit; smoke script probes for it and uses a controlled fallback login exchange (`/v1/auth/login`) for operational validation.
