#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="${COMPOSE_PROJECT_NAME:-zenops-prod}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker/compose.vps.yml}"
BACKUP_FILE="${1:-}"

if [[ -z "${BACKUP_FILE}" ]]; then
  echo "Usage: $0 /path/to/zenops-YYYYMMDDTHHMMSSZ.dump.gz"
  exit 1
fi

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

echo "Restoring from ${BACKUP_FILE}"

gzip -dc "${BACKUP_FILE}" | docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" exec -T postgres \
  pg_restore -U postgres -d zenops --clean --if-exists --no-owner --no-privileges

echo "Restore complete"
