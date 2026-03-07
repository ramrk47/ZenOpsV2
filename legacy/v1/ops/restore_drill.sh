#!/usr/bin/env bash
#
# Phase 8 restore drill:
#   1) create a fresh backup via ops/backup_now.sh
#   2) restore into isolated test DB
#   3) verify alembic revision + key table counts
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

DEFAULT_COMPOSE_FILE="docker-compose.hostinger.yml"
if [ ! -f "$DEFAULT_COMPOSE_FILE" ]; then
  DEFAULT_COMPOSE_FILE="docker-compose.yml"
fi

COMPOSE_FILE="${COMPOSE_FILE:-$DEFAULT_COMPOSE_FILE}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-maulya}"
RESTORE_DB_NAME="${RESTORE_DB_NAME:-maulya_restore_test}"
BACKUP_HOST_PATH="${BACKUP_HOST_PATH:-./deploy/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-21}"
I_UNDERSTAND="${I_UNDERSTAND:-0}"

COMPOSE=(docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME")

log() {
  printf '[%s] %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*"
}

error() {
  printf '[%s] ERROR: %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*" >&2
  exit 1
}

compose() {
  "${COMPOSE[@]}" "$@"
}

wait_for_db() {
  local timeout="${1:-120}"
  local elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    if compose exec -T db sh -lc 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 1
}

load_env_file() {
  local env_file="$1"
  if [ -f "$env_file" ]; then
    # shellcheck source=/dev/null
    source "$env_file"
  fi
}

apply_retention() {
  mkdir -p "$BACKUP_HOST_PATH"
  local deleted
  deleted="$(find "$BACKUP_HOST_PATH" -maxdepth 1 -type f -name "*_db_*.sql.gz" -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete || true)"
  if [ -n "$deleted" ]; then
    log "Deleted backups by retention (${BACKUP_RETENTION_DAYS} days):"
    printf '%s\n' "$deleted"
  else
    log "No backup artifacts exceeded retention (${BACKUP_RETENTION_DAYS} days)."
  fi
}

if [ ! -f "$COMPOSE_FILE" ]; then
  error "Compose file not found: $COMPOSE_FILE"
fi

if [[ ! "$RESTORE_DB_NAME" =~ ^[a-zA-Z0-9_]+$ ]]; then
  error "RESTORE_DB_NAME must match ^[a-zA-Z0-9_]+$"
fi

set -a
load_env_file ".env"
load_env_file ".env.backend"
set +a

POSTGRES_USER="${POSTGRES_USER:-maulya}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-change_me}"
POSTGRES_DB="${POSTGRES_DB:-maulya}"

if [ "$RESTORE_DB_NAME" = "$POSTGRES_DB" ] && [ "$I_UNDERSTAND" != "1" ]; then
  error "RESTORE_DB_NAME matches live DB ($POSTGRES_DB). Refusing without I_UNDERSTAND=1."
fi

log "Using compose file: $COMPOSE_FILE"
log "Using compose project: $COMPOSE_PROJECT_NAME"
log "Restore drill target DB: $RESTORE_DB_NAME"

compose config -q
compose up -d db
if ! wait_for_db 120; then
  error "Database did not become ready in time"
fi

log "Step 1/4: Creating fresh backup via ops/backup_now.sh..."
COMPOSE_FILE="$COMPOSE_FILE" COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" BACKUP_HOST_PATH="$BACKUP_HOST_PATH" ./ops/backup_now.sh

LATEST_BACKUP="$(ls -1t "$BACKUP_HOST_PATH"/*_db_*.sql.gz 2>/dev/null | head -n 1 || true)"
if [ -z "$LATEST_BACKUP" ] || [ ! -f "$LATEST_BACKUP" ]; then
  error "Fresh DB backup artifact not found in $BACKUP_HOST_PATH"
fi
log "Fresh backup selected: $LATEST_BACKUP"

apply_retention

log "Step 2/4: Restoring backup into isolated database '$RESTORE_DB_NAME'..."
compose exec -T db sh -lc "PGPASSWORD=\"\$POSTGRES_PASSWORD\" psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d postgres -c \"DROP DATABASE IF EXISTS $RESTORE_DB_NAME;\""
compose exec -T db sh -lc "PGPASSWORD=\"\$POSTGRES_PASSWORD\" psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d postgres -c \"CREATE DATABASE $RESTORE_DB_NAME;\""

if ! gunzip -c "$LATEST_BACKUP" | compose exec -T db sh -lc "PGPASSWORD=\"\$POSTGRES_PASSWORD\" psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"$RESTORE_DB_NAME\""; then
  error "Restore into $RESTORE_DB_NAME failed"
fi

RESTORE_DATABASE_URL="postgresql+psycopg2://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${RESTORE_DB_NAME}"

log "Step 3/4: Running integrity checks (alembic current + key table counts)..."
if ! compose run --rm -e DATABASE_URL="$RESTORE_DATABASE_URL" migrate alembic current >/tmp/maulya_restore_drill_alembic.txt 2>&1; then
  cat /tmp/maulya_restore_drill_alembic.txt
  error "alembic current failed against restored database"
fi
ALEMBIC_RESULT="$(tail -n 1 /tmp/maulya_restore_drill_alembic.txt || true)"
log "Alembic current: ${ALEMBIC_RESULT:-unknown}"

users_count="$(compose exec -T db sh -lc "PGPASSWORD=\"\$POSTGRES_PASSWORD\" psql -t -A -U \"\$POSTGRES_USER\" -d \"$RESTORE_DB_NAME\" -c 'SELECT count(*) FROM users;'")"
assignments_count="$(compose exec -T db sh -lc "PGPASSWORD=\"\$POSTGRES_PASSWORD\" psql -t -A -U \"\$POSTGRES_USER\" -d \"$RESTORE_DB_NAME\" -c 'SELECT count(*) FROM assignments;'")"
invoices_count="$(compose exec -T db sh -lc "PGPASSWORD=\"\$POSTGRES_PASSWORD\" psql -t -A -U \"\$POSTGRES_USER\" -d \"$RESTORE_DB_NAME\" -c 'SELECT count(*) FROM invoices;'")"

users_count="$(echo "$users_count" | tr -d '[:space:]')"
assignments_count="$(echo "$assignments_count" | tr -d '[:space:]')"
invoices_count="$(echo "$invoices_count" | tr -d '[:space:]')"

if [ -z "$users_count" ] || [ -z "$assignments_count" ] || [ -z "$invoices_count" ]; then
  error "Integrity checks failed to return table counts"
fi

log "users=$users_count assignments=$assignments_count invoices=$invoices_count"

log "Step 4/4: Restore drill verdict..."
echo ""
echo "========================================"
echo "RESTORE DRILL: PASS"
echo "========================================"
echo "Backup file:   $LATEST_BACKUP"
echo "Target DB:     $RESTORE_DB_NAME"
echo "Alembic:       ${ALEMBIC_RESULT:-unknown}"
echo "Users count:   $users_count"
echo "Assignments:   $assignments_count"
echo "Invoices:      $invoices_count"
echo ""
echo "Safety note: live database '$POSTGRES_DB' was not modified."
