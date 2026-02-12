#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="${COMPOSE_PROJECT_NAME:-zenops-prod}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker/compose.vps.yml}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/zenops}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${BACKUP_DIR}/zenops-${TIMESTAMP}.dump"

mkdir -p "${BACKUP_DIR}"

echo "Creating backup: ${OUT_FILE}"
docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" exec -T postgres \
  pg_dump -U postgres -d zenops -Fc >"${OUT_FILE}"

gzip -f "${OUT_FILE}"

echo "Pruning backups older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -type f -name 'zenops-*.dump.gz' -mtime "+${RETENTION_DAYS}" -delete

echo "Backup complete: ${OUT_FILE}.gz"
