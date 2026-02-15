#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_PORT="${API_PORT:-3000}"
POSTGRES_BIND_PORT="${POSTGRES_BIND_PORT:-55432}"
REDIS_BIND_PORT="${REDIS_BIND_PORT:-56379}"
API_BASE_URL="${API_BASE_URL:-}"
ZENOPS_V2_API_BASE_URL="${ZENOPS_V2_API_BASE_URL:-}"
source "$ROOT_DIR/scripts/lib/resolve-v2-api.sh"
apply_v2_api_base "can-start"

JWT_SECRET="${JWT_SECRET:-dev-secret}"
ZENOPS_MULTI_TENANT_ENABLED="${ZENOPS_MULTI_TENANT_ENABLED:-false}"
ZENOPS_INTERNAL_TENANT_ID="${ZENOPS_INTERNAL_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
ZENOPS_EXTERNAL_TENANT_ID="${ZENOPS_EXTERNAL_TENANT_ID:-22222222-2222-2222-2222-222222222222}"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-/tmp/zenops-artifacts}"
STORAGE_DRIVER="${STORAGE_DRIVER:-local}"
DATABASE_URL_ROOT="${DATABASE_URL_ROOT:-postgresql://postgres:postgres@localhost:${POSTGRES_BIND_PORT}/zenops}"
DATABASE_URL="${DATABASE_URL:-postgresql://zen_api:zen_api@localhost:${POSTGRES_BIND_PORT}/zenops}"
DATABASE_URL_API="${DATABASE_URL_API:-$DATABASE_URL}"
DATABASE_URL_WORKER="${DATABASE_URL_WORKER:-postgresql://zen_worker:zen_worker@localhost:${POSTGRES_BIND_PORT}/zenops}"
REDIS_URL="${REDIS_URL:-redis://localhost:${REDIS_BIND_PORT}}"

DEMO_PROVIDER_EMAIL_TO="${DEMO_PROVIDER_EMAIL_TO:-}"
DEMO_PROVIDER_WHATSAPP_TO="${DEMO_PROVIDER_WHATSAPP_TO:-}"

API_PID=""
WORKER_PID=""
API_LAST_STATUS=""
API_LAST_BODY=""

cleanup() {
  if [[ -n "$WORKER_PID" ]] && kill -0 "$WORKER_PID" >/dev/null 2>&1; then
    kill "$WORKER_PID" >/dev/null 2>&1 || true
    wait "$WORKER_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" >/dev/null 2>&1; then
    kill "$API_PID" >/dev/null 2>&1 || true
    wait "$API_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $cmd"
    exit 1
  fi
}

json_eval() {
  local json="$1"
  local expr="$2"
  printf '%s' "$json" | node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const expr = process.argv[1];
const out = Function("data", `return (${expr});`)(data);
if (out === undefined || out === null) process.exit(2);
if (typeof out === "object") process.stdout.write(JSON.stringify(out));
else process.stdout.write(String(out));
' "$expr"
}

api_call() {
  local method="$1"
  local path="$2"
  local token="${3:-}"
  local body="${4:-}"
  local -a headers=()
  local response

  if [[ -n "$token" ]]; then
    headers+=(-H "authorization: Bearer $token")
  fi
  if [[ -n "$body" ]]; then
    headers+=(-H "content-type: application/json")
    response="$(curl -sS -X "$method" "${headers[@]}" --data "$body" -w $'\n%{http_code}' "${API_BASE_URL}${path}")"
  else
    response="$(curl -sS -X "$method" "${headers[@]}" -w $'\n%{http_code}' "${API_BASE_URL}${path}")"
  fi

  API_LAST_STATUS="${response##*$'\n'}"
  API_LAST_BODY="${response%$'\n'*}"
}

require_http_ok() {
  if [[ "$API_LAST_STATUS" -lt 200 || "$API_LAST_STATUS" -gt 299 ]]; then
    echo "ERROR: API request failed (HTTP $API_LAST_STATUS)"
    echo "$API_LAST_BODY"
    exit 1
  fi
}

wait_for_api() {
  for _ in $(seq 1 40); do
    if curl -fsS "${API_BASE_URL}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

is_port_in_use() {
  local port="$1"
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
    return $?
  fi
  return 1
}

pick_available_port() {
  local start="$1"
  local end=$((start + 20))
  local candidate
  for ((candidate = start; candidate <= end; candidate++)); do
    if ! is_port_in_use "$candidate"; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

run_setup() {
  echo "Resetting local demo state..."
  env \
    POSTGRES_BIND_PORT="$POSTGRES_BIND_PORT" \
    DATABASE_URL_ROOT="$DATABASE_URL_ROOT" \
    DATABASE_URL="$DATABASE_URL" \
    ARTIFACTS_DIR="$ARTIFACTS_DIR" \
    ./scripts/reset-demo.sh >/tmp/zenops-demo-providers-reset.log 2>&1
}

start_stack() {
  local provider_email="$1"
  local provider_whatsapp="$2"

  if [[ "${ZENOPS_V2_API_BASE_SOURCE:-}" == "default" ]] && is_port_in_use "$API_PORT"; then
    local original_port="$API_PORT"
    local next_port
    next_port="$(pick_available_port $((API_PORT + 1)) || true)"
    if [[ -n "$next_port" ]]; then
      API_PORT="$next_port"
      API_BASE_URL="http://127.0.0.1:${API_PORT}/v1"
      export API_PORT API_BASE_URL ZENOPS_V2_API_BASE_URL="$API_BASE_URL"
      echo "Port ${original_port} is busy; using API_PORT=${API_PORT} for demo."
    else
      echo "ERROR: could not find a free API port after ${original_port}."
      exit 1
    fi
  fi

  env \
    API_PORT="$API_PORT" \
    DATABASE_URL="$DATABASE_URL" \
    DATABASE_URL_API="$DATABASE_URL_API" \
    DATABASE_URL_WORKER="$DATABASE_URL_WORKER" \
    DATABASE_URL_ROOT="$DATABASE_URL_ROOT" \
    REDIS_URL="$REDIS_URL" \
    ZENOPS_MULTI_TENANT_ENABLED="$ZENOPS_MULTI_TENANT_ENABLED" \
    ZENOPS_INTERNAL_TENANT_ID="$ZENOPS_INTERNAL_TENANT_ID" \
    ZENOPS_EXTERNAL_TENANT_ID="$ZENOPS_EXTERNAL_TENANT_ID" \
    JWT_SECRET="$JWT_SECRET" \
    ARTIFACTS_DIR="$ARTIFACTS_DIR" \
    STORAGE_DRIVER="$STORAGE_DRIVER" \
    NOTIFY_PROVIDER_EMAIL="$provider_email" \
    NOTIFY_PROVIDER_WHATSAPP="$provider_whatsapp" \
    pnpm --filter @zenops/api build >/tmp/zenops-demo-providers-api-build.log 2>&1

  (
    cd apps/api
    env \
      API_PORT="$API_PORT" \
      DATABASE_URL="$DATABASE_URL" \
      DATABASE_URL_API="$DATABASE_URL_API" \
      DATABASE_URL_WORKER="$DATABASE_URL_WORKER" \
      DATABASE_URL_ROOT="$DATABASE_URL_ROOT" \
      REDIS_URL="$REDIS_URL" \
      ZENOPS_MULTI_TENANT_ENABLED="$ZENOPS_MULTI_TENANT_ENABLED" \
      ZENOPS_INTERNAL_TENANT_ID="$ZENOPS_INTERNAL_TENANT_ID" \
      ZENOPS_EXTERNAL_TENANT_ID="$ZENOPS_EXTERNAL_TENANT_ID" \
      JWT_SECRET="$JWT_SECRET" \
      ARTIFACTS_DIR="$ARTIFACTS_DIR" \
      STORAGE_DRIVER="$STORAGE_DRIVER" \
      NOTIFY_PROVIDER_EMAIL="$provider_email" \
      NOTIFY_PROVIDER_WHATSAPP="$provider_whatsapp" \
      node dist/main.js
  ) >/tmp/zenops-demo-providers-api.log 2>&1 &
  API_PID="$!"

  env \
    JWT_SECRET="$JWT_SECRET" \
    DATABASE_URL_API="$DATABASE_URL_API" \
    DATABASE_URL_ROOT="$DATABASE_URL_ROOT" \
    DATABASE_URL_WORKER="$DATABASE_URL_WORKER" \
    REDIS_URL="$REDIS_URL" \
    ARTIFACTS_DIR="$ARTIFACTS_DIR" \
    ZENOPS_INTERNAL_TENANT_ID="$ZENOPS_INTERNAL_TENANT_ID" \
    ZENOPS_EXTERNAL_TENANT_ID="$ZENOPS_EXTERNAL_TENANT_ID" \
    NOTIFY_PROVIDER_EMAIL="$provider_email" \
    NOTIFY_PROVIDER_WHATSAPP="$provider_whatsapp" \
    pnpm --filter @zenops/worker build >/tmp/zenops-demo-providers-worker-build.log 2>&1

  (
    cd apps/worker
    env \
      JWT_SECRET="$JWT_SECRET" \
      DATABASE_URL_API="$DATABASE_URL_API" \
      DATABASE_URL_ROOT="$DATABASE_URL_ROOT" \
      DATABASE_URL_WORKER="$DATABASE_URL_WORKER" \
      REDIS_URL="$REDIS_URL" \
      ARTIFACTS_DIR="$ARTIFACTS_DIR" \
      ZENOPS_INTERNAL_TENANT_ID="$ZENOPS_INTERNAL_TENANT_ID" \
      ZENOPS_EXTERNAL_TENANT_ID="$ZENOPS_EXTERNAL_TENANT_ID" \
      NOTIFY_PROVIDER_EMAIL="$provider_email" \
      NOTIFY_PROVIDER_WHATSAPP="$provider_whatsapp" \
      node dist/index.js
  ) >/tmp/zenops-demo-providers-worker.log 2>&1 &
  WORKER_PID="$!"

  if ! wait_for_api; then
    echo "ERROR: API failed to start."
    tail -n 100 /tmp/zenops-demo-providers-api.log || true
    exit 1
  fi
  sleep 2
}

stop_stack() {
  cleanup
  API_PID=""
  WORKER_PID=""
}

studio_login() {
  api_call "POST" "/auth/login" "" "{\"aud\":\"studio\",\"tenant_id\":\"${ZENOPS_INTERNAL_TENANT_ID}\",\"user_id\":\"44444444-4444-4444-4444-444444444444\",\"sub\":\"44444444-4444-4444-4444-444444444444\",\"roles\":[\"super_admin\"],\"capabilities\":[\"notifications.send\"]}"
  require_http_ok
  json_eval "$API_LAST_BODY" "data.access_token"
}

wait_outbox_status() {
  local token="$1"
  local idempotency_key="$2"
  local expected="$3"
  local status=""

  for _ in $(seq 1 30); do
    api_call "GET" "/notifications/outbox?limit=200" "$token"
    require_http_ok
    status="$(json_eval "$API_LAST_BODY" "(() => { const row = Array.isArray(data) ? data.find((r) => r.idempotency_key === '${idempotency_key}') : null; return row ? row.status : ''; })()")"
    if [[ "$status" == "$expected" ]]; then
      echo "$status"
      return 0
    fi
    sleep 1
  done

  echo "$status"
  return 1
}

send_notify_test() {
  local token="$1"
  local channel="$2"
  local to="$3"
  local idempotency_key="notify-test:${ZENOPS_INTERNAL_TENANT_ID}:${channel}:${to:-default}"
  local payload

  if [[ -n "$to" ]]; then
    payload="{\"channel\":\"${channel}\",\"to\":\"${to}\"}"
  else
    payload="{\"channel\":\"${channel}\"}"
  fi

  api_call "POST" "/notify/test" "$token" "$payload"
  require_http_ok

  if ! wait_outbox_status "$token" "$idempotency_key" "sent" >/dev/null; then
    echo "ERROR: outbox did not reach sent for ${channel} (${idempotency_key})"
    exit 1
  fi

  echo "PASS ${channel} notify/test (${idempotency_key})"
}

main() {
  require_cmd curl
  require_cmd node
  require_cmd pnpm

  run_setup

  echo "Phase 1: NOOP provider mode"
  start_stack "noop" "noop"
  local studio_token
  studio_token="$(studio_login)"
  send_notify_test "$studio_token" "email" ""
  stop_stack

  local run_real=0
  if [[ -n "${MAILGUN_API_KEY:-}" && -n "${MAILGUN_DOMAIN:-}" && -n "${MAILGUN_FROM:-}" && -n "$DEMO_PROVIDER_EMAIL_TO" ]]; then
    run_real=1
  fi
  if [[ -n "${TWILIO_ACCOUNT_SID:-}" && -n "${TWILIO_AUTH_TOKEN:-}" && -n "${TWILIO_WHATSAPP_FROM:-}" && -n "$DEMO_PROVIDER_WHATSAPP_TO" ]]; then
    run_real=1
  fi

  if [[ "$run_real" != "1" ]]; then
    echo "Skipping real-provider phase (set provider env vars + DEMO_PROVIDER_EMAIL_TO/DEMO_PROVIDER_WHATSAPP_TO)."
    exit 0
  fi

  echo "Phase 2: Real provider mode (best effort with configured secrets)"
  start_stack "${NOTIFY_PROVIDER_EMAIL:-mailgun}" "${NOTIFY_PROVIDER_WHATSAPP:-twilio}"
  studio_token="$(studio_login)"

  if [[ -n "${MAILGUN_API_KEY:-}" && -n "${MAILGUN_DOMAIN:-}" && -n "${MAILGUN_FROM:-}" && -n "$DEMO_PROVIDER_EMAIL_TO" ]]; then
    send_notify_test "$studio_token" "email" "$DEMO_PROVIDER_EMAIL_TO"
  else
    echo "Skipping real email send (missing MAILGUN_* or DEMO_PROVIDER_EMAIL_TO)."
  fi

  if [[ -n "${TWILIO_ACCOUNT_SID:-}" && -n "${TWILIO_AUTH_TOKEN:-}" && -n "${TWILIO_WHATSAPP_FROM:-}" && -n "$DEMO_PROVIDER_WHATSAPP_TO" ]]; then
    send_notify_test "$studio_token" "whatsapp" "$DEMO_PROVIDER_WHATSAPP_TO"
  else
    echo "Skipping real whatsapp send (missing TWILIO_* or DEMO_PROVIDER_WHATSAPP_TO)."
  fi

  stop_stack
}

main "$@"
