#!/usr/bin/env bash
#
# Production-like smoke for local compose:
# db -> migrate -> backend -> health/security probes.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.dev.yml}"
CURL_BASE="${CURL_BASE:-http://127.0.0.1:8000}"
RATE_LIMIT_PROBE_ATTEMPTS="${RATE_LIMIT_PROBE_ATTEMPTS:-6}"
SMOKE_ALLOWED_ORIGIN="${SMOKE_ALLOWED_ORIGIN:-https://portal.example.com}"
SMOKE_JWT_SECRET="${SMOKE_JWT_SECRET:-phase8-smoke-super-secret-1234567890}"
SMOKE_DATABASE_URL="${SMOKE_DATABASE_URL:-postgresql+psycopg2://zenops:change%5Fme@db:5432/zenops}"
SMOKE_CONTAINER_ID=""

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

wait_ready() {
  local timeout="${1:-90}"
  local elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    if curl -fsS "$CURL_BASE/readyz" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 1
}

cleanup() {
  if [ -n "$SMOKE_CONTAINER_ID" ]; then
    docker rm -f "$SMOKE_CONTAINER_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "[smoke] using compose file: $COMPOSE_FILE"
compose up -d db
compose run --rm backend alembic upgrade head
compose stop backend >/dev/null 2>&1 || true

SMOKE_CONTAINER_ID="$(
  compose run -d --service-ports \
    -e ENVIRONMENT=production \
    -e ALLOW_ORIGINS="$SMOKE_ALLOWED_ORIGIN" \
    -e JWT_SECRET="$SMOKE_JWT_SECRET" \
    -e DATABASE_URL="$SMOKE_DATABASE_URL" \
    backend uvicorn app.main:app --host 0.0.0.0 --port 8000
)"
echo "[smoke] backend container: $SMOKE_CONTAINER_ID"

if ! wait_ready 120; then
  echo "[smoke] FAIL: backend did not become ready" >&2
  exit 1
fi

echo "[smoke] health probes"
HEALTH="$(curl -fsS "$CURL_BASE/healthz")"
READY="$(curl -fsS "$CURL_BASE/readyz")"
VERSION="$(curl -fsS "$CURL_BASE/version")"
echo "  /healthz => $HEALTH"
echo "  /readyz  => $READY"
echo "  /version => $VERSION"

echo "[smoke] security headers"
HEADERS="$(curl -sSI "$CURL_BASE/healthz" | tr -d '\r')"
echo "$HEADERS" | grep -qi '^x-content-type-options: nosniff$' || { echo "Missing X-Content-Type-Options" >&2; exit 1; }
echo "$HEADERS" | grep -qi '^x-frame-options: DENY$' || { echo "Missing X-Frame-Options" >&2; exit 1; }
echo "$HEADERS" | grep -qi '^referrer-policy: no-referrer$' || { echo "Missing Referrer-Policy" >&2; exit 1; }
echo "$HEADERS" | grep -qi '^permissions-policy:' || { echo "Missing Permissions-Policy" >&2; exit 1; }
echo "$HEADERS" | grep -qi '^content-security-policy-report-only:' || { echo "Missing CSP report-only header" >&2; exit 1; }

echo "[smoke] CORS production-origin enforcement"
CORS_CODE="$(curl -s -o /tmp/zenops_cors_probe.json -w '%{http_code}' -H 'Origin: https://evil.example.com' "$CURL_BASE/version")"
if [ "$CORS_CODE" -ne 403 ]; then
  echo "Expected 403 for unknown Origin, got $CORS_CODE" >&2
  cat /tmp/zenops_cors_probe.json >&2 || true
  exit 1
fi
echo "  unknown-origin status => $CORS_CODE"

echo "[smoke] login rate-limit probe"
LAST_LOGIN_CODE="000"
for _ in $(seq 1 "$RATE_LIMIT_PROBE_ATTEMPTS"); do
  LAST_LOGIN_CODE="$(curl -s -o /tmp/zenops_login_probe.json -w '%{http_code}' -X POST "$CURL_BASE/api/auth/login" -H 'Content-Type: application/x-www-form-urlencoded' --data 'username=smoke-rate-limit@example.com&password=invalid')"
done
if [ "$LAST_LOGIN_CODE" -ne 429 ]; then
  echo "Expected login rate limit to trigger 429, got $LAST_LOGIN_CODE" >&2
  cat /tmp/zenops_login_probe.json >&2 || true
  exit 1
fi
echo "  login rate-limit status => $LAST_LOGIN_CODE"

echo "[smoke] PASS"
