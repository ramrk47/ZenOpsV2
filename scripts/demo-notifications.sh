#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_PORT="${API_PORT:-3000}"
POSTGRES_BIND_PORT="${POSTGRES_BIND_PORT:-55432}"
REDIS_BIND_PORT="${REDIS_BIND_PORT:-56379}"
if [[ -z "${API_BASE_URL:-}" ]]; then
  API_BASE_URL="http://127.0.0.1:${API_PORT}/v1"
  API_BASE_URL_WAS_DEFAULT="1"
else
  API_BASE_URL_WAS_DEFAULT="0"
fi

JWT_SECRET="${JWT_SECRET:-dev-secret}"
ZENOPS_MULTI_TENANT_ENABLED="${ZENOPS_MULTI_TENANT_ENABLED:-false}"
ZENOPS_INTERNAL_TENANT_ID="${ZENOPS_INTERNAL_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
ZENOPS_EXTERNAL_TENANT_ID="${ZENOPS_EXTERNAL_TENANT_ID:-22222222-2222-2222-2222-222222222222}"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-/tmp/zenops-artifacts}"
STORAGE_DRIVER="${STORAGE_DRIVER:-local}"
DISABLE_QUEUE="${DISABLE_QUEUE:-false}"

DATABASE_URL_ROOT="${DATABASE_URL_ROOT:-postgresql://postgres:postgres@localhost:${POSTGRES_BIND_PORT}/zenops}"
DATABASE_URL="${DATABASE_URL:-postgresql://zen_api:zen_api@localhost:${POSTGRES_BIND_PORT}/zenops}"
DATABASE_URL_API="${DATABASE_URL_API:-$DATABASE_URL}"
DATABASE_URL_WORKER="${DATABASE_URL_WORKER:-postgresql://zen_worker:zen_worker@localhost:${POSTGRES_BIND_PORT}/zenops}"
REDIS_URL="${REDIS_URL:-redis://localhost:${REDIS_BIND_PORT}}"

DEMO_ASSUME_INFRA_RUNNING="${DEMO_ASSUME_INFRA_RUNNING:-0}"
DEMO_ASSUME_API_RUNNING="${DEMO_ASSUME_API_RUNNING:-0}"
DEMO_ASSUME_WORKER_RUNNING="${DEMO_ASSUME_WORKER_RUNNING:-0}"
DEMO_FORCE_RESET="${DEMO_FORCE_RESET:-1}"

API_PID=""
WORKER_PID=""
API_LAST_STATUS=""
API_LAST_BODY=""

cleanup() {
  if [[ -n "$WORKER_PID" ]]; then
    if kill -0 "$WORKER_PID" >/dev/null 2>&1; then
      kill "$WORKER_PID" >/dev/null 2>&1 || true
      wait "$WORKER_PID" >/dev/null 2>&1 || true
    fi
  fi

  if [[ -n "$API_PID" ]]; then
    if kill -0 "$API_PID" >/dev/null 2>&1; then
      kill "$API_PID" >/dev/null 2>&1 || true
      wait "$API_PID" >/dev/null 2>&1 || true
    fi
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
let out;
try {
  out = Function("data", `return (${expr});`)(data);
} catch {
  process.exit(1);
}
if (out === undefined || out === null) process.exit(2);
if (typeof out === "object") {
  process.stdout.write(JSON.stringify(out));
} else {
  process.stdout.write(String(out));
}
' "$expr"
}

json_eval_optional() {
  local json="$1"
  local expr="$2"
  if ! json_eval "$json" "$expr" 2>/dev/null; then
    true
  fi
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
    headers+=(-H 'content-type: application/json')
    response="$(
      curl -sS \
        -X "$method" \
        "${headers[@]}" \
        --data "$body" \
        -w $'\n%{http_code}' \
        "${API_BASE_URL}${path}"
    )"
  else
    response="$(
      curl -sS \
        -X "$method" \
        "${headers[@]}" \
        -w $'\n%{http_code}' \
        "${API_BASE_URL}${path}"
    )"
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
  local attempts=40
  local i
  for ((i = 1; i <= attempts; i++)); do
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

start_api_if_needed() {
  if [[ "$DEMO_ASSUME_API_RUNNING" == "1" ]]; then
    return
  fi

  if [[ "$API_BASE_URL_WAS_DEFAULT" == "1" ]] && is_port_in_use "$API_PORT"; then
    local original_port="$API_PORT"
    local next_port
    next_port="$(pick_available_port $((API_PORT + 1)) || true)"
    if [[ -n "$next_port" ]]; then
      API_PORT="$next_port"
      API_BASE_URL="http://127.0.0.1:${API_PORT}/v1"
      echo "Port ${original_port} is busy; using API_PORT=${API_PORT} for demo."
    else
      echo "ERROR: could not find a free API port after ${original_port}."
      exit 1
    fi
  fi

  echo "Starting API on port ${API_PORT}..."
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
    DISABLE_QUEUE="$DISABLE_QUEUE" \
    pnpm --filter @zenops/api build >/tmp/zenops-demo-notify-api-build.log 2>&1

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
      DISABLE_QUEUE="$DISABLE_QUEUE" \
      node dist/main.js
  ) >/tmp/zenops-demo-notify-api.log 2>&1 &
  API_PID="$!"

  if ! wait_for_api; then
    echo "ERROR: API did not become healthy in time."
    if [[ -f /tmp/zenops-demo-notify-api.log ]]; then
      echo "--- API log ---"
      tail -n 100 /tmp/zenops-demo-notify-api.log || true
      echo "---------------"
    fi
    exit 1
  fi
}

start_worker_if_needed() {
  if [[ "$DEMO_ASSUME_WORKER_RUNNING" == "1" ]]; then
    return
  fi

  echo "Starting worker for notifications queue..."
  env \
    DATABASE_URL_WORKER="$DATABASE_URL_WORKER" \
    REDIS_URL="$REDIS_URL" \
    ARTIFACTS_DIR="$ARTIFACTS_DIR" \
    ZENOPS_INTERNAL_TENANT_ID="$ZENOPS_INTERNAL_TENANT_ID" \
    ZENOPS_EXTERNAL_TENANT_ID="$ZENOPS_EXTERNAL_TENANT_ID" \
    pnpm --filter @zenops/worker build >/tmp/zenops-demo-notify-worker-build.log 2>&1

  (
    cd apps/worker
    env \
      DATABASE_URL_WORKER="$DATABASE_URL_WORKER" \
      REDIS_URL="$REDIS_URL" \
      ARTIFACTS_DIR="$ARTIFACTS_DIR" \
      ZENOPS_INTERNAL_TENANT_ID="$ZENOPS_INTERNAL_TENANT_ID" \
      ZENOPS_EXTERNAL_TENANT_ID="$ZENOPS_EXTERNAL_TENANT_ID" \
      node dist/index.js
  ) >/tmp/zenops-demo-notify-worker.log 2>&1 &
  WORKER_PID="$!"

  sleep 2
}

run_setup() {
  if [[ "$DEMO_FORCE_RESET" == "1" ]]; then
    echo "Resetting demo state first (deterministic mode)..."
    env \
      POSTGRES_BIND_PORT="$POSTGRES_BIND_PORT" \
      DATABASE_URL_ROOT="$DATABASE_URL_ROOT" \
      DATABASE_URL="$DATABASE_URL" \
      ARTIFACTS_DIR="$ARTIFACTS_DIR" \
      ./scripts/reset-demo.sh >/tmp/zenops-demo-notify-reset.log 2>&1
    return
  fi

  if [[ "$DEMO_ASSUME_INFRA_RUNNING" != "1" ]]; then
    echo "Bringing up infra services..."
    pnpm infra:up >/tmp/zenops-demo-notify-infra.log 2>&1
  fi

  echo "Bootstrapping database..."
  env \
    DATABASE_URL_ROOT="$DATABASE_URL_ROOT" \
    DATABASE_URL="$DATABASE_URL" \
    POSTGRES_BIND_PORT="$POSTGRES_BIND_PORT" \
    pnpm bootstrap:db >/tmp/zenops-demo-notify-bootstrap.log 2>&1
}

main() {
  require_cmd curl
  require_cmd node
  require_cmd pnpm

  run_setup
  start_api_if_needed
  start_worker_if_needed

  echo "Logging in as internal web user..."
  api_call "POST" "/auth/login" "" "{\"aud\":\"web\",\"tenant_id\":\"${ZENOPS_INTERNAL_TENANT_ID}\",\"user_id\":\"33333333-3333-3333-3333-333333333333\",\"sub\":\"33333333-3333-3333-3333-333333333333\",\"roles\":[],\"capabilities\":[]}"
  require_http_ok
  local web_token
  web_token="$(json_eval "$API_LAST_BODY" "data.access_token")"

  echo "Logging in as studio user..."
  api_call "POST" "/auth/login" "" "{\"aud\":\"studio\",\"tenant_id\":\"${ZENOPS_INTERNAL_TENANT_ID}\",\"user_id\":\"44444444-4444-4444-4444-444444444444\",\"sub\":\"44444444-4444-4444-4444-444444444444\",\"roles\":[],\"capabilities\":[]}"
  require_http_ok
  local studio_token
  studio_token="$(json_eval "$API_LAST_BODY" "data.access_token")"

  local due_date
  due_date="$(date -u +%F)"

  echo "Creating assignment (should enqueue assignment_created notification)..."
  api_call "POST" "/assignments" "$web_token" "{\"source\":\"tenant\",\"title\":\"Notify Demo Assignment $(date -u +%Y%m%d-%H%M%S)\",\"summary\":\"M4 notifications demo\",\"priority\":\"normal\",\"status\":\"requested\",\"due_date\":\"${due_date}\"}"
  require_http_ok
  local assignment_id
  assignment_id="$(json_eval "$API_LAST_BODY" "data.id")"
  local idempotency_key
  idempotency_key="assignment_created:${assignment_id}"

  local outbox_row status outbox_id attempt_no
  local poll
  for ((poll = 1; poll <= 30; poll++)); do
    api_call "GET" "/notifications/outbox?limit=100" "$studio_token"
    require_http_ok

    outbox_row="$(json_eval_optional "$API_LAST_BODY" "Array.isArray(data) ? (data.find((row) => row.idempotency_key === '${idempotency_key}') ?? null) : null")"

    if [[ -n "$outbox_row" ]]; then
      status="$(json_eval "$outbox_row" "data.status")"
      outbox_id="$(json_eval "$outbox_row" "data.id")"
      attempt_no="$(json_eval_optional "$outbox_row" "data.latest_attempt ? data.latest_attempt.attempt_no : null")"

      if [[ "$status" == "sent" && "$attempt_no" == "1" ]]; then
        break
      fi
    fi

    sleep 1
  done

  if [[ -z "$outbox_row" ]]; then
    echo "FAIL: assignment notification outbox row was not created"
    exit 1
  fi

  if [[ "${status:-}" != "sent" ]]; then
    echo "FAIL: outbox row did not reach sent state"
    echo "status=${status:-unknown} outbox_id=${outbox_id:-unknown}"
    exit 1
  fi

  if [[ "${attempt_no:-}" != "1" ]]; then
    echo "FAIL: expected exactly one attempt, got ${attempt_no:-none}"
    exit 1
  fi

  echo
  echo "PASS notifications demo"
  echo "assignment_id=${assignment_id}"
  echo "outbox_id=${outbox_id}"
  echo "status=${status} attempts=${attempt_no}"
}

main "$@"
