#!/usr/bin/env bash
# One-off backup job (pg_dump + retention logic from deploy/backup/backup.sh).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

DEFAULT_COMPOSE_FILE="docker-compose.hostinger.yml"
if [ ! -f "$DEFAULT_COMPOSE_FILE" ]; then
  DEFAULT_COMPOSE_FILE="docker-compose.yml"
fi

COMPOSE_FILE="${COMPOSE_FILE:-$DEFAULT_COMPOSE_FILE}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-zenops}"
BACKUP_HOST_PATH="${BACKUP_HOST_PATH:-./deploy/backups}"

COMPOSE=(docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME")
COMPOSE_BACKUP=(docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME" --profile backup)

log() {
  printf '[%s] %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*"
}

wait_for_db() {
  local timeout="${1:-120}"
  local elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    if "${COMPOSE[@]}" exec -T db sh -lc 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 1
}

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

"${COMPOSE[@]}" config -q

log "Ensuring database service is up..."
"${COMPOSE[@]}" up -d db
if ! wait_for_db 120; then
  echo "ERROR: Database did not become ready in time" >&2
  exit 1
fi

log "Running backup container..."
"${COMPOSE_BACKUP[@]}" run --rm backup

log "Backup finished."
if [ -d "$BACKUP_HOST_PATH" ]; then
  echo "Recent backup artifacts in $BACKUP_HOST_PATH:"
  ls -1t "$BACKUP_HOST_PATH" | head -n 10
else
  echo "Backup path does not exist yet on host: $BACKUP_HOST_PATH"
fi

if [ -n "${RCLONE_REMOTE:-}" ]; then
  echo ""
  log "Remote check (rclone lsf $RCLONE_REMOTE):"
  "${COMPOSE_BACKUP[@]}" run --rm rclone lsf "$RCLONE_REMOTE" | head -n 10 || true
fi
