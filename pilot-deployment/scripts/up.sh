#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PILOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PILOT_DIR}/.." && pwd)"

MODE="hostinger"
if [[ "${1:-}" == "--mode" && -n "${2:-}" ]]; then
  MODE="${2}"
fi

V1_ENV_FILE="${PILOT_DIR}/env/v1.env"
REPOGEN_ENV_FILE="${PILOT_DIR}/env/repogen.env"
V1_BACKEND_ENV="${REPO_ROOT}/legacy/v1/.env.backend"

log() {
  printf '[pilot-up] %s\n' "$*"
}

fail() {
  printf '[pilot-up][FAIL] %s\n' "$*" >&2
  exit 1
}

require_file() {
  local path="$1"
  [[ -f "$path" ]] || fail "Missing required file: $path"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

require_cmd docker
require_file "$V1_ENV_FILE"
require_file "$REPOGEN_ENV_FILE"
require_file "$V1_BACKEND_ENV"

if [[ "$MODE" == "hostinger" ]]; then
  log "Starting hostinger mode via pilot wrapper compose (profiles: v1 + repogen)"
  docker compose \
    -f "${PILOT_DIR}/compose.pilot.yml" \
    --env-file "$V1_ENV_FILE" \
    --env-file "$REPOGEN_ENV_FILE" \
    --profile v1 \
    --profile repogen \
    up -d --build
  log "Hostinger mode stack is up"
  exit 0
fi

if [[ "$MODE" == "local" ]]; then
  log "Starting local quick-test mode via legacy/v1 dev compose + repogen slice"
  docker compose \
    -f "${REPO_ROOT}/legacy/v1/docker-compose.dev.yml" \
    -f "${REPO_ROOT}/legacy/v1/docker-compose.repogen.yml" \
    --env-file "$V1_ENV_FILE" \
    --env-file "$REPOGEN_ENV_FILE" \
    --profile repogen-slice \
    up -d --build
  log "Local mode stack is up"
  exit 0
fi

fail "Unsupported mode: ${MODE}. Use --mode hostinger or --mode local"

