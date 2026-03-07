#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

V1_BASE_URL="${V1_BASE_URL:-}"
if [[ -z "$V1_BASE_URL" ]]; then
  if [[ -f .env ]]; then
    # shellcheck disable=SC1091
    source .env
  fi
  if [[ -n "${APP_DOMAIN:-}" ]]; then
    V1_BASE_URL="https://${APP_DOMAIN}"
  else
    V1_BASE_URL="http://localhost:8000"
  fi
fi

log() {
  printf '[smoke-v1] %s\n' "$*"
}

http_check() {
  local url="$1"
  local expected="${2:-200}"
  local code
  code="$(curl -sS -o /tmp/smoke-v1.out -w '%{http_code}' "$url" || true)"
  if [[ "$code" != "$expected" ]]; then
    log "FAIL ${url} -> HTTP ${code} (expected ${expected})"
    cat /tmp/smoke-v1.out || true
    return 1
  fi
  log "PASS ${url} -> HTTP ${code}"
  return 0
}

log "Using V1_BASE_URL=${V1_BASE_URL}"

http_check "${V1_BASE_URL}/healthz" 200
http_check "${V1_BASE_URL}/readyz" 200
http_check "${V1_BASE_URL}/version" 200
http_check "${V1_BASE_URL}/api/auth/me" 401

log "All V1 smoke checks passed"

