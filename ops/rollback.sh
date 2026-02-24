#!/usr/bin/env bash
# Roll back app containers to previous image references captured by ops/deploy.sh.
# Database restore is intentionally manual-only.
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
STATE_FILE="${STATE_FILE:-ops/releases/previous-images.env}"

log() {
  printf '[%s] %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*"
}

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

if [ ! -f "$STATE_FILE" ]; then
  echo "ERROR: rollback state file not found: $STATE_FILE" >&2
  echo "Run a deploy first so previous image references are captured." >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$STATE_FILE"

if [ -z "${PREVIOUS_API_IMAGE:-}" ] || [ -z "${PREVIOUS_FRONTEND_IMAGE:-}" ]; then
  echo "ERROR: Previous image references are missing in $STATE_FILE" >&2
  exit 1
fi

log "Using compose file: $COMPOSE_FILE"
log "Using compose project: $COMPOSE_PROJECT_NAME"
docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME" config -q
log "Rolling back to:"
log "  api/email-worker -> $PREVIOUS_API_IMAGE"
log "  frontend         -> $PREVIOUS_FRONTEND_IMAGE"

env \
  ZENOPS_API_IMAGE="$PREVIOUS_API_IMAGE" \
  ZENOPS_FRONTEND_IMAGE="$PREVIOUS_FRONTEND_IMAGE" \
  docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME" pull --ignore-pull-failures api frontend || true

env \
  ZENOPS_API_IMAGE="$PREVIOUS_API_IMAGE" \
  ZENOPS_FRONTEND_IMAGE="$PREVIOUS_FRONTEND_IMAGE" \
  docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME" up -d --no-build db api frontend email-worker

log "Rollback deployment applied."
log "Verify readiness: docker compose -f $COMPOSE_FILE -p $COMPOSE_PROJECT_NAME exec -T api curl -fsS http://127.0.0.1:8000/readyz"

echo ""
echo "Database restore (manual, only if migration/data issue):"
echo "  1) Pick backup file from ${BACKUP_DIR:-deploy/backups}"
echo "  2) gunzip -c <backup.sql.gz> | docker compose -f $COMPOSE_FILE -p $COMPOSE_PROJECT_NAME exec -T db psql -U \"\${POSTGRES_USER:-zenops}\" -d \"\${POSTGRES_DB:-zenops}\""
echo ""
echo "WARNING: rollback.sh never drops/recreates volumes and never auto-restores DB."
