# Ops Checklist (Phase 8)

## Pre-Deploy

- [ ] Branch/tag identified for deploy.
- [ ] `.env` and `.env.backend` present on VPS.
- [ ] `ENVIRONMENT=production` confirmed.
- [ ] `ALLOW_ORIGINS` is explicit and does not include `*`.
- [ ] `JWT_SECRET` rotated and strong.
- [ ] `UPLOADS_DIR` exists and is writable.
- [ ] Disk free space >= 20%.
- [ ] Backup destination has expected retention window.

## Deploy Execution

- [ ] Run `COMPOSE_FILE=docker-compose.hostinger.yml ./ops/deploy.sh`.
- [ ] Confirm pre-migration backup artifact was created.
- [ ] Confirm migration succeeded (`alembic upgrade head`).
- [ ] Confirm `/readyz` reports `status=ok`.
- [ ] Confirm smoke gate passes.

## Post-Deploy

- [ ] `curl /healthz`, `/healthz/deps`, `/readyz`, `/version` all healthy.
- [ ] Login endpoint responds and rate limiting still enforced.
- [ ] `request-access` endpoint rate limiting enforced.
- [ ] Uploads reject disallowed files.
- [ ] `./ops/watchdog_lite.sh` shows no backlog warnings.

## Backup/Restore

- [ ] Daily backup jobs successful.
- [ ] Weekly pilot restore drill executed (`./ops/restore_drill.sh`).
- [ ] Drill PASS/FAIL captured with timestamp and backup file.
- [ ] Retention cleanup logs reviewed.

## Rollback Readiness

- [ ] `ops/releases/previous-images.env` exists after deploy.
- [ ] `./ops/rollback.sh` tested in non-production before first pilot.
- [ ] Team knows DB restore is separate manual operation.
