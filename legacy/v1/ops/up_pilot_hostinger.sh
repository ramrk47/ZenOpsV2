#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ROOT_DIR}/.env"
BACKEND_ENV_FILE="${ROOT_DIR}/.env.backend"
REPOGEN_ENV_FILE="${ROOT_DIR}/deploy/repogen.env"

log() {
  printf '[up-pilot-hostinger] %s\n' "$*"
}

fail() {
  printf '[up-pilot-hostinger][FAIL] %s\n' "$*" >&2
  exit 1
}

require_file() {
  local path="$1"
  [[ -f "$path" ]] || fail "Missing required file: $path"
}

require_file "$ENV_FILE"
require_file "$BACKEND_ENV_FILE"
require_file "$REPOGEN_ENV_FILE"

export COMPOSE_BAKE=false

TRAEFIK_NETWORK="$(awk -F= '/^TRAEFIK_NETWORK=/{print $2}' "$REPOGEN_ENV_FILE" | tail -n1)"
if [[ -z "$TRAEFIK_NETWORK" ]]; then
  TRAEFIK_NETWORK="traefik-proxy"
fi

log "Ensuring traefik network exists: ${TRAEFIK_NETWORK}"
docker network create "${TRAEFIK_NETWORK}" >/dev/null 2>&1 || true

log "Starting V1 DB + permissions sidecar"
docker compose -f docker-compose.hostinger.yml up -d db uploads-perms

log "Running migrations"
docker compose -f docker-compose.hostinger.yml run --rm migrate

log "Starting V1 API/worker/frontend"
docker compose -f docker-compose.hostinger.yml up -d api email-worker frontend

log "Starting repogen slice"
docker compose \
  -f docker-compose.hostinger.yml \
  -f docker-compose.repogen.yml \
  --env-file deploy/repogen.env \
  --profile repogen-slice \
  up -d --build

log "Done. Next run smoke:"
log "  ./ops/smoke_deploy_repogen.sh"

