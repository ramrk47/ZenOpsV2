# Zen Ops Smoke Test Runbook (Hostinger)

Use after each deploy.

## Prerequisites
- `ZENOPS_DOMAIN` points to VPS IP.
- Deployment completed with `./ops/deploy.sh`.

## Quick API checks
```bash
# Internal API readiness (inside container)
docker compose -f docker-compose.hostinger.yml -p zenops exec -T api curl -fsS http://127.0.0.1:8000/readyz

# Public API path routed by Traefik
curl -fsS "https://${ZENOPS_DOMAIN}/readyz"

# Same-origin API route check
curl -fsS "https://${ZENOPS_DOMAIN}/api/healthz"
```

## UI smoke checklist
1. Login succeeds.
2. Assignments list loads with no 4xx/5xx network errors.
3. Assignment detail opens and tabs render.
4. Documents upload and preview drawer open.
5. "@ mention" behavior works in documents comment flow.
6. Admin pages load: Master Data, Personnel, Support Inbox, Backups.
7. Payroll pages load (Runs, Employees, Reports) without API base URL errors.

## Worker/ops checks
```bash
# Service health
docker compose -f docker-compose.hostinger.yml -p zenops ps

# API logs
docker compose -f docker-compose.hostinger.yml -p zenops logs --tail=200 api

# Frontend logs
docker compose -f docker-compose.hostinger.yml -p zenops logs --tail=200 frontend

# Email worker logs
docker compose -f docker-compose.hostinger.yml -p zenops logs --tail=200 email-worker
```

## Backup check
```bash
COMPOSE_FILE=docker-compose.hostinger.yml COMPOSE_PROJECT_NAME=zenops ./ops/backup_now.sh
ls -lah /opt/zenops/backups 2>/dev/null || ls -lah ./deploy/backups
```

## Pass criteria
- `/readyz` returns `{"status":"ok", ...}`.
- No browser `localhost` API calls in production.
- No critical API/worker errors in logs.
- Backup artifact created and non-empty.
