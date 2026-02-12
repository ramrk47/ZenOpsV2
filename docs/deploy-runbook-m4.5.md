# M4.5 Deployment Runbook (VPS + Traefik + Backups)

## Scope
Single always-on production-like stack on one VPS.

- `zenops.notalonestudios.com` -> web
- `studio-zenops.notalonestudios.com` -> studio (BasicAuth)
- `api-zenops.notalonestudios.com` -> API
- `portal-zenops.notalonestudios.com` -> portal

Security edge policy:
- BasicAuth always ON for Studio and API docs (`/docs`).
- Webhooks are edge-protected by default until provider go-live.
- Web and Portal are not behind BasicAuth; app-level JWT applies.

## 1. Server Prerequisites
Install on VPS:
- Docker Engine + Docker Compose plugin
- `git`, `curl`, `jq`

Recommended baseline:
- 2 vCPU / 4 GB RAM minimum
- Ubuntu 22.04+ LTS
- Static public IP

## 2. DNS Setup
Create A records to VPS IP:
- `zenops.notalonestudios.com`
- `api-zenops.notalonestudios.com`
- `studio-zenops.notalonestudios.com`
- `portal-zenops.notalonestudios.com`
- Optional dashboard: `traefik-zenops.notalonestudios.com`

## 3. Environment Setup
1. Copy `/Users/dr.156/ZenOpsV2/.env.prod.example` -> `.env.prod` on VPS.
2. Set strong secrets:
- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `BASIC_AUTH_USERS` (htpasswd hash only)
3. Configure storage:
- `STORAGE_DRIVER=s3`
- R2/S3 credentials in `S3_*`
4. Provider defaults:
- Keep `NOTIFY_PROVIDER_EMAIL=noop` and `NOTIFY_PROVIDER_WHATSAPP=noop` until ready.
- Keep `WEBHOOKS_ENABLED=false` unless provider callbacks are active.

## 4. First Deploy
From repo root on VPS:

```bash
cp .env.prod.example .env.prod
# edit .env.prod

docker compose -p zenops-prod -f infra/docker/compose.vps.yml pull

docker compose -p zenops-prod -f infra/docker/compose.vps.yml up -d postgres redis

# Bootstrap DB roles, RLS, seeds once
DATABASE_URL_ROOT="postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:5432/zenops" \
DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:5432/zenops" \
pnpm bootstrap:db

docker compose -p zenops-prod -f infra/docker/compose.vps.yml up -d
```

## 5. Update / Rollout Protocol
For every release:

1. Backup first:
```bash
./scripts/prod-pre-migrate-backup.sh
```

2. Pull and restart services:
```bash
git fetch origin
git checkout main
git pull origin main

docker compose -p zenops-prod -f infra/docker/compose.vps.yml pull
docker compose -p zenops-prod -f infra/docker/compose.vps.yml up -d
```

3. Run migrations/bootstrap changes:
```bash
DATABASE_URL_ROOT="postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:5432/zenops" \
DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:5432/zenops" \
pnpm bootstrap:db
```

4. Smoke tests:
- `/v1/health`
- Assignment flow demo
- Billing demo
- Notifications demo
- Mobile docs demo (`/Users/dr.156/ZenOpsV2/scripts/demo-mobile-docs.sh`)

## 6. Backups
Nightly backup via cron:

```cron
30 1 * * * cd /opt/zenops && COMPOSE_PROJECT_NAME=zenops-prod ./scripts/prod-backup-db.sh >> /var/log/zenops-backup.log 2>&1
```

Restore:

```bash
COMPOSE_PROJECT_NAME=zenops-prod ./scripts/prod-restore-db.sh /var/backups/zenops/zenops-YYYYMMDDTHHMMSSZ.dump.gz
```

## 7. Off-Hours Idle Downshift
Keep API/web/portal reachable, downshift worker only:

```bash
./scripts/prod-offhours.sh downshift
./scripts/prod-offhours.sh upshift
```

Suggested cron:

```cron
0 23 * * * cd /opt/zenops && COMPOSE_PROJECT_NAME=zenops-prod ./scripts/prod-offhours.sh downshift
0 9 * * * cd /opt/zenops && COMPOSE_PROJECT_NAME=zenops-prod ./scripts/prod-offhours.sh upshift
```

## 8. Rollback
1. Re-point to previous git tag or image tag.
2. `docker compose ... up -d` with previous version.
3. If schema/data issue: restore latest known good dump.

## 9. Security Notes
- Never commit `.env.prod`.
- Keep provider keys only in server env.
- Keep BasicAuth enabled for Studio and API docs.
- Enable webhooks only with signature validation and live keys.
