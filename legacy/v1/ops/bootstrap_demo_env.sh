#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.demo"
BACKEND_ENV_FILE="${ROOT_DIR}/.env.demo.backend"

FORCE=0
if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
fi

DEMO_DOMAIN="${DEMO_DOMAIN:-demo.maulya.in}"
TRAEFIK_CERTRESOLVER="${TRAEFIK_CERTRESOLVER:-letsencrypt}"
POSTGRES_DB="${POSTGRES_DB:-maulya_demo}"
POSTGRES_USER="${POSTGRES_USER:-maulya_demo}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -hex 16)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 48)}"

log() {
  printf '[bootstrap-demo-env] %s\n' "$*"
}

fail() {
  printf '[bootstrap-demo-env][FAIL] %s\n' "$*" >&2
  exit 1
}

write_file() {
  local path="$1"
  local content="$2"
  if [[ -f "$path" && "$FORCE" != "1" ]]; then
    fail "Refusing to overwrite existing file: $path (rerun with --force)"
  fi
  printf '%s\n' "$content" >"$path"
}

command -v openssl >/dev/null 2>&1 || fail "openssl is required"

write_file "$ENV_FILE" "COMPOSE_PROJECT_NAME=maulya-demo
BACKEND_ENV_FILE=.env.demo.backend
APP_DOMAIN=${DEMO_DOMAIN}
TRAEFIK_CERTRESOLVER=${TRAEFIK_CERTRESOLVER}
TRAEFIK_ROUTER_PREFIX=maulya-demo

POSTGRES_DB=${POSTGRES_DB}
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

VITE_API_URL=/api
VITE_V2_WEB_URL=https://app.maulya.in
VITE_PILOT_MODE=1
VITE_ENABLE_STRUCTURED_INPUTS=0
VITE_DEMO_MODE=1
VITE_APP_INSTANCE=demo

BACKUP_HOST_PATH=/opt/maulya/demo-backups"

write_file "$BACKEND_ENV_FILE" "ENVIRONMENT=demo
PILOT_MODE=1
DEMO_MODE=1
DATABASE_URL=postgresql+psycopg2://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
REDIS_URL=redis://redis:6379/0
JWT_SECRET=${JWT_SECRET}
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=120
ALLOW_DESTRUCTIVE_ACTIONS=true
APP_INSTANCE=demo
COOKIE_PREFIX=maulya_demo

PUBLIC_BASE_URL=https://${DEMO_DOMAIN}
ALLOW_ORIGINS=https://maulya.in,https://app.maulya.in,https://demo.maulya.in

UPLOADS_DIR=/app/uploads
MAX_UPLOAD_MB=8
AV_SCAN_ENABLED=0

EMAIL_PROVIDER=disabled
ASSOCIATE_ONBOARDING_MODE=INVITE_ONLY
ASSOCIATE_EMAIL_MODE=disabled
ASSOCIATE_EMAIL_VERIFY_REQUIRED=0
ASSOCIATE_AUTO_APPROVE_DOMAINS=[]

DB_POOL_SIZE=5
DB_MAX_OVERFLOW=10
DB_POOL_TIMEOUT=30
DB_POOL_RECYCLE=1800

RATE_LIMIT_LOGIN_IP_MAX=20
RATE_LIMIT_LOGIN_IP_WINDOW_SECONDS=60
RATE_LIMIT_LOGIN_EMAIL_MAX=200
RATE_LIMIT_LOGIN_EMAIL_WINDOW_SECONDS=60
RATE_LIMIT_REQUEST_ACCESS_IP_MAX=2
RATE_LIMIT_REQUEST_ACCESS_IP_WINDOW_SECONDS=86400
RATE_LIMIT_REQUEST_ACCESS_EMAIL_MAX=2
RATE_LIMIT_REQUEST_ACCESS_EMAIL_WINDOW_SECONDS=86400
RATE_LIMIT_PASSWORD_RESET_EMAIL_MAX=1
RATE_LIMIT_PASSWORD_RESET_EMAIL_WINDOW_SECONDS=3600"

log "Generated:"
log "  ${ENV_FILE}"
log "  ${BACKEND_ENV_FILE}"
log ""
log "Next:"
log "  ./ops/demo_up.sh"
log "  ./ops/demo_reset.sh"
log "  ./ops/demo_smoke.sh"
