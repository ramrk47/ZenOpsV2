#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

V1_BASE_URL="${V1_BASE_URL:-http://localhost:8000}"
REPOGEN_BASE_URL="${REPOGEN_BASE_URL:-http://localhost:3000}"
REPOGEN_WEB_URL="${REPOGEN_WEB_URL:-http://localhost:5174}"
V1_ADMIN_EMAIL="${V1_ADMIN_EMAIL:-admin@zenops.local}"
V1_ADMIN_PASSWORD="${V1_ADMIN_PASSWORD:-admin123}"
REPOGEN_INTERNAL_TENANT_ID="${REPOGEN_INTERNAL_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
REPOGEN_BRIDGE_USER_ID="${REPOGEN_BRIDGE_USER_ID:-33333333-3333-3333-3333-333333333333}"
REPOGEN_BRIDGE_AUD="${REPOGEN_BRIDGE_AUD:-web}"
REPOGEN_BRIDGE_CAPABILITIES_JSON="${REPOGEN_BRIDGE_CAPABILITIES_JSON:-[\"*\"]}"
REPOGEN_BRIDGE_EXCHANGE_PATH="${REPOGEN_BRIDGE_EXCHANGE_PATH:-/v1/auth/bridge/exchange}"
SMOKE_SKIP_V1="${SMOKE_SKIP_V1:-0}"

log() {
  printf '[smoke-repogen] %s\n' "$*"
}

fail() {
  printf '[smoke-repogen][FAIL] %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

json_get() {
  local path="$1"
  local payload="$2"
  JSON_PATH="$path" JSON_PAYLOAD="$payload" python3 - <<'PY'
import json
import os
import sys

path = [p for p in os.environ["JSON_PATH"].split('.') if p]
obj = json.loads(os.environ["JSON_PAYLOAD"])
cur = obj
for key in path:
    if isinstance(cur, list):
        cur = cur[int(key)]
    else:
        cur = cur[key]
if isinstance(cur, (dict, list)):
    print(json.dumps(cur))
elif cur is None:
    print("")
else:
    print(cur)
PY
}

http_check() {
  local url="$1"
  local expected_code="${2:-200}"
  local out_file
  out_file="$(mktemp)"
  local code
  code="$(curl -sS -o "$out_file" -w '%{http_code}' "$url" || true)"
  if [[ "$code" != "$expected_code" ]]; then
    log "Unexpected response from ${url} (HTTP ${code}):"
    cat "$out_file" || true
    rm -f "$out_file"
    fail "HTTP check failed for ${url}"
  fi
  rm -f "$out_file"
}

require_cmd curl
require_cmd python3

log "Checking Repogen API/Web health"
http_check "${REPOGEN_BASE_URL}/v1/health" 200
http_check "${REPOGEN_WEB_URL}" 200

if [[ "$SMOKE_SKIP_V1" != "1" ]]; then
  log "Checking V1 health endpoints"
  http_check "${V1_BASE_URL}/healthz" 200
  http_check "${V1_BASE_URL}/readyz" 200
  http_check "${V1_BASE_URL}/version" 200

  log "Authenticating in V1"
  V1_LOGIN_RESPONSE="$(curl -sS -X POST "${V1_BASE_URL}/api/auth/login" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode "username=${V1_ADMIN_EMAIL}" \
    --data-urlencode "password=${V1_ADMIN_PASSWORD}")"
  V1_TOKEN="$(json_get access_token "$V1_LOGIN_RESPONSE" 2>/dev/null || true)"
  [[ -n "$V1_TOKEN" ]] || fail "V1 login failed (missing access_token)"

  V1_ME_RESPONSE="$(curl -sS "${V1_BASE_URL}/api/auth/me" -H "Authorization: Bearer ${V1_TOKEN}")"
  V1_ROLE="$(json_get role "$V1_ME_RESPONSE" 2>/dev/null || true)"
  if [[ -z "$V1_ROLE" || "$V1_ROLE" == "null" ]]; then
    V1_ROLE="ADMIN"
  fi
  export V1_ROLE
else
  log "Skipping V1 checks/auth because SMOKE_SKIP_V1=1"
  V1_ROLE="ADMIN"
  export V1_ROLE
fi

REPOGEN_TOKEN=""

if [[ "$SMOKE_SKIP_V1" != "1" ]]; then
  log "Probing V1 bridge-token endpoint"
  BRIDGE_TMP="$(mktemp)"
  BRIDGE_CODE="$(curl -sS -o "$BRIDGE_TMP" -w '%{http_code}' -X POST "${V1_BASE_URL}/api/auth/bridge-token" \
    -H "Authorization: Bearer ${V1_TOKEN}" \
    -H 'Content-Type: application/json' \
    -d '{"aud":"zenops-v2-bridge"}' || true)"

  if [[ "$BRIDGE_CODE" == "200" ]]; then
    log "Bridge-token endpoint available; attempting exchange at ${REPOGEN_BRIDGE_EXCHANGE_PATH}"
    BRIDGE_TOKEN="$(json_get bridge_token "$(cat "$BRIDGE_TMP")" 2>/dev/null || true)"
    if [[ -n "$BRIDGE_TOKEN" ]]; then
      EXCHANGE_TMP="$(mktemp)"
      EXCHANGE_CODE="$(curl -sS -o "$EXCHANGE_TMP" -w '%{http_code}' -X POST "${REPOGEN_BASE_URL}${REPOGEN_BRIDGE_EXCHANGE_PATH}" \
        -H 'Content-Type: application/json' \
        -d "{\"bridge_token\":\"${BRIDGE_TOKEN}\"}" || true)"
      if [[ "$EXCHANGE_CODE" == "200" ]]; then
        REPOGEN_TOKEN="$(json_get access_token "$(cat "$EXCHANGE_TMP")" 2>/dev/null || true)"
      else
        log "Bridge exchange endpoint returned ${EXCHANGE_CODE}; falling back to direct auth/login"
      fi
      rm -f "$EXCHANGE_TMP"
    fi
  else
    log "Bridge-token endpoint not present on this RC (HTTP ${BRIDGE_CODE}); using direct auth/login fallback"
  fi
  rm -f "$BRIDGE_TMP"
fi

if [[ -z "$REPOGEN_TOKEN" ]]; then
  LOGIN_PAYLOAD="$(python3 - <<PY
import json
import os
try:
  caps = json.loads(os.environ.get('REPOGEN_BRIDGE_CAPABILITIES_JSON', '["*"]'))
except Exception:
  caps = ["*"]
if not isinstance(caps, list):
  caps = ["*"]
print(json.dumps({
  'sub': os.environ.get('REPOGEN_BRIDGE_USER_ID', '33333333-3333-3333-3333-333333333333'),
  'tenant_id': os.environ.get('REPOGEN_INTERNAL_TENANT_ID', '11111111-1111-1111-1111-111111111111'),
  'user_id': os.environ.get('REPOGEN_BRIDGE_USER_ID', '33333333-3333-3333-3333-333333333333'),
  'aud': os.environ.get('REPOGEN_BRIDGE_AUD', 'web'),
  'roles': ['super_admin', os.environ.get('V1_ROLE', 'ADMIN')],
  'capabilities': caps,
}))
PY
)"
  REPOGEN_LOGIN_RESPONSE="$(curl -sS -X POST "${REPOGEN_BASE_URL}/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d "$LOGIN_PAYLOAD")"
  REPOGEN_TOKEN="$(json_get access_token "$REPOGEN_LOGIN_RESPONSE" 2>/dev/null || true)"
fi

[[ -n "$REPOGEN_TOKEN" ]] || fail "Repogen auth exchange failed (missing access_token)"

log "Validating Repogen protected endpoint"
WORK_ORDERS_TMP="$(mktemp)"
WORK_ORDERS_CODE="$(curl -sS -o "$WORK_ORDERS_TMP" -w '%{http_code}' "${REPOGEN_BASE_URL}/v1/repogen/work-orders" \
  -H "Authorization: Bearer ${REPOGEN_TOKEN}" || true)"
if [[ "$WORK_ORDERS_CODE" != "200" ]]; then
  log "Repogen /work-orders response:"
  cat "$WORK_ORDERS_TMP" || true
  rm -f "$WORK_ORDERS_TMP"
  fail "Repogen protected endpoint check failed"
fi
rm -f "$WORK_ORDERS_TMP"

log "PASS: V1 + Repogen deployment smoke checks succeeded"
