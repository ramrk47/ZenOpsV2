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
SMOKE_HOST_PORT="${SMOKE_HOST_PORT:-}"
RATE_LIMIT_PROBE_ATTEMPTS="${RATE_LIMIT_PROBE_ATTEMPTS:-6}"
SMOKE_ALLOWED_ORIGIN="${SMOKE_ALLOWED_ORIGIN:-https://portal.example.com}"
SMOKE_JWT_SECRET="${SMOKE_JWT_SECRET:-phase8-smoke-super-secret-1234567890}"
SMOKE_DATABASE_URL="${SMOKE_DATABASE_URL:-postgresql+psycopg2://maulya:change%5Fme@db:5432/maulya}"
SMOKE_ASSOCIATE_PASSWORD="${SMOKE_ASSOCIATE_PASSWORD:-Associate!234}"
SMOKE_ASSOCIATE_EMAIL="${SMOKE_ASSOCIATE_EMAIL:-smoke-associate-$(date +%s)@example.com}"
SMOKE_CONTAINER_IDS=()

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
  for container_id in "${SMOKE_CONTAINER_IDS[@]-}"; do
    if [ -n "$container_id" ]; then
      docker rm -f "$container_id" >/dev/null 2>&1 || true
    fi
  done
}
trap cleanup EXIT

start_backend() {
  local container_id
  container_id="$(
    compose run -d -p "${SMOKE_HOST_PORT}:8000" "$@" \
      backend uvicorn app.main:app --host 0.0.0.0 --port 8000
  )"
  SMOKE_CONTAINER_IDS+=("$container_id")
  echo "$container_id"
}

if [ -z "$SMOKE_HOST_PORT" ]; then
  SMOKE_HOST_PORT="$(
    python3 - <<'PY'
import socket
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
    s.bind(("127.0.0.1", 0))
    print(s.getsockname()[1])
PY
  )"
fi
CURL_BASE="${CURL_BASE:-http://127.0.0.1:${SMOKE_HOST_PORT}}"

echo "[smoke] using compose file: $COMPOSE_FILE"
echo "[smoke] using host port: $SMOKE_HOST_PORT"
compose down -v >/dev/null 2>&1 || true
compose up -d db
compose run --rm backend alembic upgrade head
compose stop backend >/dev/null 2>&1 || true

echo "[smoke] non-prod associate request-access + verify"
NONPROD_BACKEND_ID="$(
  start_backend \
    -e ENVIRONMENT=development \
    -e ASSOCIATE_ONBOARDING_MODE=REQUEST_ACCESS_AUTO_APPROVE \
    -e ASSOCIATE_EMAIL_VERIFY_REQUIRED=1 \
    -e ASSOCIATE_AUTO_APPROVE_PASSWORD="$SMOKE_ASSOCIATE_PASSWORD" \
    -e ALLOW_ORIGINS="$SMOKE_ALLOWED_ORIGIN,http://localhost:5173,http://127.0.0.1:5173" \
    -e JWT_SECRET="$SMOKE_JWT_SECRET" \
    -e DATABASE_URL="$SMOKE_DATABASE_URL"
)"
echo "[smoke] non-prod backend container: $NONPROD_BACKEND_ID"

if ! wait_ready 120; then
  echo "[smoke] FAIL: non-prod backend did not become ready" >&2
  exit 1
fi

REQUEST_CODE="$(curl -s -o /tmp/maulya_request_access.json -w '%{http_code}' \
  -X POST "$CURL_BASE/api/partner/request-access" \
  -H 'Content-Type: application/json' \
  --data "{\"company_name\":\"Smoke Associate Co\",\"contact_name\":\"Smoke Associate\",\"email\":\"$SMOKE_ASSOCIATE_EMAIL\",\"phone\":\"9999999999\",\"city\":\"Chennai\",\"requested_interface\":\"associate\"}")"
if [ "$REQUEST_CODE" -ne 201 ]; then
  echo "Expected request-access to return 201, got $REQUEST_CODE" >&2
  cat /tmp/maulya_request_access.json >&2 || true
  exit 1
fi
echo "  request-access status => $REQUEST_CODE"

VERIFY_TOKEN="$(
  compose run --rm -e SMOKE_ASSOCIATE_EMAIL="$SMOKE_ASSOCIATE_EMAIL" backend python - <<'PY'
import os
import re
import sys
from sqlalchemy import create_engine, text

db_url = os.environ["DATABASE_URL"]
email = os.environ["SMOKE_ASSOCIATE_EMAIL"]
engine = create_engine(db_url)
with engine.connect() as conn:
    row = conn.execute(
        text(
            """
            SELECT payload_json->>'text'
            FROM email_delivery_logs
            WHERE event_type = 'ASSOCIATE_ACCESS_VERIFY'
              AND to_email = :email
            ORDER BY id DESC
            LIMIT 1
            """
        ),
        {"email": email},
    ).first()

if not row or not row[0]:
    sys.exit(1)

match = re.search(r"/partner/verify\?token=([^\s]+)", row[0])
if not match:
    sys.exit(1)

print(match.group(1))
PY
)"
if [ -z "$VERIFY_TOKEN" ]; then
  echo "Unable to retrieve associate verify token from email logs" >&2
  exit 1
fi

VERIFY_CODE="$(curl -s -o /tmp/maulya_verify_access.json -w '%{http_code}' \
  -X POST "$CURL_BASE/api/partner/verify-access-token" \
  -H 'Content-Type: application/json' \
  --data "{\"token\":\"$VERIFY_TOKEN\"}")"
if [ "$VERIFY_CODE" -ne 200 ]; then
  echo "Expected verify-access-token to return 200, got $VERIFY_CODE" >&2
  cat /tmp/maulya_verify_access.json >&2 || true
  exit 1
fi
VERIFY_STATUS="$(python3 - <<'PY'
import json
with open("/tmp/maulya_verify_access.json", "r", encoding="utf-8") as fp:
    print((json.load(fp).get("status") or "").strip())
PY
)"
if [ "$VERIFY_STATUS" != "APPROVED" ] && [ "$VERIFY_STATUS" != "VERIFIED_PENDING_REVIEW" ]; then
  echo "Unexpected verify status: $VERIFY_STATUS" >&2
  cat /tmp/maulya_verify_access.json >&2 || true
  exit 1
fi
echo "  verify-access-token status => $VERIFY_CODE ($VERIFY_STATUS)"

docker rm -f "$NONPROD_BACKEND_ID" >/dev/null 2>&1 || true

PROD_BACKEND_ID="$(
  start_backend \
    -e ENVIRONMENT=production \
    -e ALLOW_ORIGINS="$SMOKE_ALLOWED_ORIGIN" \
    -e JWT_SECRET="$SMOKE_JWT_SECRET" \
    -e DATABASE_URL="$SMOKE_DATABASE_URL"
)"
echo "[smoke] production-like backend container: $PROD_BACKEND_ID"

if ! wait_ready 120; then
  echo "[smoke] FAIL: production backend did not become ready" >&2
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
CORS_CODE="$(curl -s -o /tmp/maulya_cors_probe.json -w '%{http_code}' -H 'Origin: https://evil.example.com' "$CURL_BASE/version")"
if [ "$CORS_CODE" -ne 403 ]; then
  echo "Expected 403 for unknown Origin, got $CORS_CODE" >&2
  cat /tmp/maulya_cors_probe.json >&2 || true
  exit 1
fi
echo "  unknown-origin status => $CORS_CODE"

echo "[smoke] login rate-limit probe"
LAST_LOGIN_CODE="000"
for _ in $(seq 1 "$RATE_LIMIT_PROBE_ATTEMPTS"); do
  LAST_LOGIN_CODE="$(curl -s -o /tmp/maulya_login_probe.json -w '%{http_code}' -X POST "$CURL_BASE/api/auth/login" -H 'Content-Type: application/x-www-form-urlencoded' --data 'username=smoke-rate-limit@example.com&password=invalid')"
done
if [ "$LAST_LOGIN_CODE" -ne 429 ]; then
  echo "Expected login rate limit to trigger 429, got $LAST_LOGIN_CODE" >&2
  cat /tmp/maulya_login_probe.json >&2 || true
  exit 1
fi
echo "  login rate-limit status => $LAST_LOGIN_CODE"

echo "[smoke] backups endpoint admin-only guard"
ASSOC_LOGIN_CODE="$(curl -s -o /tmp/maulya_associate_login.json -w '%{http_code}' \
  -X POST "$CURL_BASE/api/auth/login" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "username=$SMOKE_ASSOCIATE_EMAIL" \
  --data-urlencode "password=$SMOKE_ASSOCIATE_PASSWORD")"
if [ "$ASSOC_LOGIN_CODE" -ne 200 ]; then
  echo "Expected associate login to return 200, got $ASSOC_LOGIN_CODE" >&2
  cat /tmp/maulya_associate_login.json >&2 || true
  exit 1
fi

ASSOC_TOKEN="$(python3 - <<'PY'
import json
with open("/tmp/maulya_associate_login.json", "r", encoding="utf-8") as fp:
    print((json.load(fp).get("access_token") or "").strip())
PY
)"
if [ -z "$ASSOC_TOKEN" ]; then
  echo "Associate login did not return an access token" >&2
  cat /tmp/maulya_associate_login.json >&2 || true
  exit 1
fi

BACKUPS_CODE="$(curl -s -o /tmp/maulya_backups_guard.json -w '%{http_code}' \
  -H "Authorization: Bearer $ASSOC_TOKEN" \
  "$CURL_BASE/api/backups")"
if [ "$BACKUPS_CODE" -ne 403 ]; then
  echo "Expected /api/backups to deny non-admin with 403, got $BACKUPS_CODE" >&2
  cat /tmp/maulya_backups_guard.json >&2 || true
  exit 1
fi
echo "  backups non-admin guard status => $BACKUPS_CODE"

echo "[smoke] PASS"
