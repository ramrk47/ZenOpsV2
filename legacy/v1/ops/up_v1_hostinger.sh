#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ROOT_DIR}/.env"
BACKEND_ENV_FILE="${ROOT_DIR}/.env.backend"

log() {
  printf '[up-v1-hostinger] %s\n' "$*"
}

fail() {
  printf '[up-v1-hostinger][FAIL] %s\n' "$*" >&2
  exit 1
}

require_backend_env_nonempty() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" "$BACKEND_ENV_FILE" | tail -n1 | cut -d= -f2- || true)"
  [[ -n "$value" ]] || fail "Missing required ${key} in .env.backend"
}

[[ -f "$ENV_FILE" ]] || fail "Missing .env. Run ./ops/bootstrap_v1_env.sh first."
[[ -f "$BACKEND_ENV_FILE" ]] || fail "Missing .env.backend. Run ./ops/bootstrap_v1_env.sh first."
require_backend_env_nonempty "JWT_SECRET"
require_backend_env_nonempty "DATABASE_URL"

export COMPOSE_BAKE=false

log "Ensuring external traefik network exists"
docker network create traefik-proxy >/dev/null 2>&1 || true

log "Building API + frontend images from current checkout"
docker compose -p zenops -f docker-compose.hostinger.yml build api frontend

log "Starting DB and uploads permissions sidecar"
docker compose -p zenops -f docker-compose.hostinger.yml up -d db uploads-perms

log "Running migrations"
docker compose -p zenops -f docker-compose.hostinger.yml run --rm migrate

log "Starting API, worker, frontend"
docker compose -p zenops -f docker-compose.hostinger.yml up -d api email-worker frontend

log "V1 stack is up"
