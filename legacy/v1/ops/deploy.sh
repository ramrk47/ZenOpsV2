#!/usr/bin/env bash
#
# Zen Ops Hostinger deployment workflow
# preflight -> backup -> migrate -> up -> readiness -> smoke
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
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-zenops}"
ENV_FILE="${ENV_FILE:-.env}"
ENV_BACKEND_FILE="${ENV_BACKEND_FILE:-.env.backend}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-3}"
BACKUP_DIR="${BACKUP_DIR:-deploy/backups}"
MIN_DISK_FREE_PERCENT="${MIN_DISK_FREE_PERCENT:-15}"

COMPOSE=(docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME")

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
  echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $*"
}

warn() {
  echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $*" >&2
}

error() {
  echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $*" >&2
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

load_env_files() {
  set -a
  if [ -f "$ENV_FILE" ]; then
    # shellcheck source=/dev/null
    source "$ENV_FILE"
  fi
  if [ -f "$ENV_BACKEND_FILE" ]; then
    # shellcheck source=/dev/null
    source "$ENV_BACKEND_FILE"
  fi
  set +a
}

is_production_env() {
  case "${ENVIRONMENT:-${ENV:-development}}" in
    production|prod)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

assert_no_wildcard_origins_in_production() {
  if ! is_production_env; then
    return 0
  fi

  local origins=",${ALLOW_ORIGINS:-},"
  if echo "$origins" | grep -Eq ',[[:space:]]*\*[[:space:]]*,'; then
    error "ALLOW_ORIGINS cannot include '*' in production"
  fi
}

check_disk_space() {
  local free_percent
  free_percent="$(df -Pk "$REPO_ROOT" | awk 'NR==2 {gsub(/%/, "", $5); print 100-$5}')"
  if [ -z "$free_percent" ]; then
    error "Unable to determine disk free space"
  fi
  if [ "$free_percent" -lt "$MIN_DISK_FREE_PERCENT" ]; then
    error "Disk free space too low (${free_percent}% < ${MIN_DISK_FREE_PERCENT}%)"
  fi
  log "Disk free space check passed (${free_percent}% free)"
}

check_uploads_writable() {
  if ! compose run --rm --no-deps api sh -lc 'set -e; target="${UPLOADS_DIR:-/app/uploads}"; mkdir -p "$target"; probe="$target/.deploy_write_probe"; echo ok > "$probe"; rm -f "$probe"'; then
    error "Uploads directory is not writable inside API container"
  fi
  log "Uploads directory write check passed"
}

current_image_for() {
  local service="$1"
  local cid
  cid="$(compose ps -q "$service" 2>/dev/null || true)"
  if [ -z "$cid" ]; then
    echo ""
    return 0
  fi
  docker inspect --format '{{.Config.Image}}' "$cid" 2>/dev/null || true
}

create_pre_migration_backup() {
  local ts backup_path
  ts="$(date -u +'%Y%m%dT%H%M%SZ')"
  backup_path="$BACKUP_DIR/pre_migration_${ts}.sql.gz"

  if ! compose exec -T db sh -lc 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h 127.0.0.1 -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip -9 > "$backup_path"; then
    rm -f "$backup_path"
    return 1
  fi
  if [ ! -s "$backup_path" ]; then
    rm -f "$backup_path"
    return 1
  fi
  log "Pre-migration backup created: $backup_path"
  return 0
}

wait_for_api_ready() {
  local elapsed=0
  local ready_payload=""

  while [ "$elapsed" -lt "$HEALTH_TIMEOUT" ]; do
    ready_payload="$(compose exec -T api curl -fsS http://127.0.0.1:8000/readyz 2>/dev/null || true)"
    if echo "$ready_payload" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
      echo "$ready_payload"
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
    elapsed=$((elapsed + HEALTH_INTERVAL))
  done
  return 1
}

run_smoke_checks() {
  local health_payload ready_payload version_payload
  local login_code inbox_code

  health_payload="$(compose exec -T api curl -fsS http://127.0.0.1:8000/healthz)"
  ready_payload="$(compose exec -T api curl -fsS http://127.0.0.1:8000/readyz)"
  version_payload="$(compose exec -T api curl -fsS http://127.0.0.1:8000/version)"

  login_code="$(compose exec -T api sh -lc "curl -s -o /tmp/deploy_login_probe.json -w '%{http_code}' -X POST http://127.0.0.1:8000/api/auth/login -H 'Content-Type: application/x-www-form-urlencoded' --data 'username=smoke@example.com&password=invalid'")"
  case "$login_code" in
    400|401|422|429) ;;
    *)
      error "Smoke check failed: /api/auth/login returned unexpected status $login_code"
      ;;
  esac

  inbox_code="$(compose exec -T api sh -lc "curl -s -o /tmp/deploy_inbox_probe.json -w '%{http_code}' http://127.0.0.1:8000/api/approvals/inbox")"
  case "$inbox_code" in
    401|403) ;;
    *)
      error "Smoke check failed: /api/approvals/inbox should require auth (got $inbox_code)"
      ;;
  esac

  log "Smoke /healthz: $health_payload"
  log "Smoke /readyz: $ready_payload"
  log "Smoke /version: $version_payload"
  log "Smoke auth/login probe status: $login_code"
  log "Smoke approvals/inbox unauth probe status: $inbox_code"
}

if [ ! -f "$COMPOSE_FILE" ]; then
  error "Compose file not found: $COMPOSE_FILE"
fi
if [ ! -f "$ENV_FILE" ]; then
  error "Missing required env file: $ENV_FILE"
fi
if [ ! -f "$ENV_BACKEND_FILE" ]; then
  error "Missing required env file: $ENV_BACKEND_FILE"
fi

load_env_files

log "Using compose file: $COMPOSE_FILE"
log "Using compose project: $COMPOSE_PROJECT_NAME"
log "Environment: ${ENVIRONMENT:-${ENV:-development}}"

log "Preflight: validating compose configuration..."
compose config -q
check_disk_space
assert_no_wildcard_origins_in_production
check_uploads_writable

mkdir -p "$BACKUP_DIR" ops/releases

PREV_API_IMAGE="$(current_image_for api)"
PREV_FRONTEND_IMAGE="$(current_image_for frontend)"
PREV_WORKER_IMAGE="$(current_image_for email-worker)"

log "Current image tags before deploy:"
log "  api=${PREV_API_IMAGE:-<none>}"
log "  frontend=${PREV_FRONTEND_IMAGE:-<none>}"
log "  email-worker=${PREV_WORKER_IMAGE:-<none>}"

STATE_FILE="ops/releases/previous-images.env"
cat > "$STATE_FILE" <<EOF
# Generated by ops/deploy.sh
COMPOSE_FILE=${COMPOSE_FILE}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME}
CAPTURED_AT=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
PREVIOUS_API_IMAGE=${PREV_API_IMAGE}
PREVIOUS_FRONTEND_IMAGE=${PREV_FRONTEND_IMAGE}
PREVIOUS_EMAIL_WORKER_IMAGE=${PREV_WORKER_IMAGE}
EOF
log "Saved rollback state to $STATE_FILE"

log "Step 1/6: Pulling images (best effort)..."
if ! compose pull --ignore-pull-failures; then
  warn "Some images could not be pulled; continuing (local build may be used)."
fi

log "Preflight: ensuring database is reachable..."
compose up -d db
if ! wait_for_db 120; then
  error "Database did not become ready in time"
fi

log "Step 2/6: Pre-migration backup..."
if is_production_env; then
  if ! create_pre_migration_backup; then
    error "Pre-migration backup failed in production"
  fi
else
  if ! create_pre_migration_backup; then
    warn "Pre-migration backup failed in non-production; continuing."
  fi
fi

log "Step 3/6: Running migrations (alembic upgrade head)..."
compose run --rm migrate alembic upgrade head

log "Step 4/6: Starting application services..."
compose up -d db api frontend email-worker

log "Step 5/6: Waiting for API readiness (/readyz)..."
READY_PAYLOAD="$(wait_for_api_ready || true)"
if [ -z "$READY_PAYLOAD" ]; then
  error "API readiness check failed after ${HEALTH_TIMEOUT}s"
fi
log "API ready: $READY_PAYLOAD"

log "Step 6/6: Running smoke checks..."
run_smoke_checks

echo ""
echo "========================================"
echo "Zen Ops deploy completed"
echo "========================================"
if [ -n "${ZENOPS_DOMAIN:-}" ]; then
  echo "Web URL:   https://${ZENOPS_DOMAIN}"
  echo "API URL:   https://${ZENOPS_DOMAIN}/api"
  echo "Ready URL: https://${ZENOPS_DOMAIN}/readyz"
else
  echo "Set ZENOPS_DOMAIN to print public HTTPS URLs"
fi
echo ""
echo "Rollback helper: ./ops/rollback.sh"
echo "Manual DB restore helper: ./ops/restore.sh"
echo ""
