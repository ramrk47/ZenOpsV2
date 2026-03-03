# Phase 8 Deploy Runbook (Hostinger VPS)

This runbook is the production-safe sequence for ZenOps V1 on a single VPS.

## 1) Initial Deploy

```bash
cd /opt/zenops/legacy/v1
cp .env.example .env
cp .env.backend.example .env.backend
cp .env.frontend.example .env.frontend

# edit secrets and origins
nano .env
nano .env.backend

# bootstrap database schema
COMPOSE_FILE=docker-compose.hostinger.yml ./ops/deploy.sh
```

## 2) Update Deploy (minimal downtime)

```bash
cd /opt/zenops/legacy/v1
git fetch --all
git pull --ff-only

# optional: pull image tags into env before deploy
# export ZENOPS_API_IMAGE=ghcr.io/<org>/zenops-api:<tag>
# export ZENOPS_FRONTEND_IMAGE=ghcr.io/<org>/zenops-frontend:<tag>

COMPOSE_FILE=docker-compose.hostinger.yml ./ops/deploy.sh
```

Deploy flow is: preflight -> backup (prod) -> migrate -> start services -> readiness -> smoke gate.

## 3) Rollback

```bash
cd /opt/zenops/legacy/v1
COMPOSE_FILE=docker-compose.hostinger.yml ./ops/rollback.sh
```

Notes:
- `ops/deploy.sh` stores previous image references in `ops/releases/previous-images.env`.
- Rollback only re-points images and restarts services. DB restore is a separate manual action.

## 4) Restore Drill (weekly during pilot)

```bash
cd /opt/zenops/legacy/v1
COMPOSE_FILE=docker-compose.hostinger.yml ./ops/restore_drill.sh
```

Safety:
- Drill restore targets an isolated DB (for example `zenops_restore_test`).
- Live DB is protected; touching live DB requires explicit `I_UNDERSTAND=1`.

## 5) Manual Restore (disaster path)

```bash
cd /opt/zenops/legacy/v1
MODE=disaster CONFIRM=YES BACKUP_FILE=/opt/zenops/backups/<file>.dump ./ops/restore.sh
```

Always run `./ops/restore_drill.sh` before any real restore event.

## 6) Post-Deploy Verification

```bash
# host health checks
curl -fsS https://<domain>/healthz
curl -fsS https://<domain>/readyz
curl -fsS https://<domain>/version

# watchdog-lite quick signal check
./ops/watchdog_lite.sh
```

## 7) Operations Cadence

- Daily: backup verification (`ops/backup_now.sh` logs + backup artifact presence).
- Every deploy: run deploy smoke gate and spot-check login + assignment flows.
- Weekly (pilot): run restore drill and record PASS/FAIL with backup artifact used.
