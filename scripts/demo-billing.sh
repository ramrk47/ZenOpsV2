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
if [[ "${ZENOPS_V2_API_BASE_SOURCE:-}" == "default" ]]; then
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

DATABASE_URL_ROOT="${DATABASE_URL_ROOT:-postgresql://postgres:postgres@localhost:${POSTGRES_BIND_PORT}/zenops}"
DATABASE_URL="${DATABASE_URL:-postgresql://zen_api:zen_api@localhost:${POSTGRES_BIND_PORT}/zenops}"
DATABASE_URL_API="${DATABASE_URL_API:-$DATABASE_URL}"
DATABASE_URL_WORKER="${DATABASE_URL_WORKER:-postgresql://zen_worker:zen_worker@localhost:${POSTGRES_BIND_PORT}/zenops}"
REDIS_URL="${REDIS_URL:-redis://localhost:${REDIS_BIND_PORT}}"

DEMO_ASSUME_INFRA_RUNNING="${DEMO_ASSUME_INFRA_RUNNING:-0}"
DEMO_ASSUME_API_RUNNING="${DEMO_ASSUME_API_RUNNING:-0}"
DEMO_FORCE_RESET="${DEMO_FORCE_RESET:-1}"

API_PID=""
API_LAST_STATUS=""
API_LAST_BODY=""

cleanup() {
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

  if curl -fsS "${API_BASE_URL}/health" >/dev/null 2>&1; then
    echo "API is already running at ${API_BASE_URL}"
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
    pnpm --filter @zenops/api build >/tmp/zenops-demo-billing-api-build.log 2>&1

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
      node dist/main.js
  ) >/tmp/zenops-demo-billing-api.log 2>&1 &
  API_PID="$!"

  if ! wait_for_api; then
    echo "ERROR: API did not become healthy in time."
    if [[ -f /tmp/zenops-demo-billing-api.log ]]; then
      echo "--- API log ---"
      tail -n 100 /tmp/zenops-demo-billing-api.log || true
      echo "---------------"
    fi
    exit 1
  fi
}

run_setup() {
  if [[ "$DEMO_FORCE_RESET" == "1" ]]; then
    echo "Resetting demo state first (deterministic mode)..."
    env \
      POSTGRES_BIND_PORT="$POSTGRES_BIND_PORT" \
      DATABASE_URL_ROOT="$DATABASE_URL_ROOT" \
      DATABASE_URL="$DATABASE_URL" \
      ARTIFACTS_DIR="$ARTIFACTS_DIR" \
      ./scripts/reset-demo.sh >/tmp/zenops-demo-billing-reset.log 2>&1
    return
  fi

  if [[ "$DEMO_ASSUME_INFRA_RUNNING" != "1" ]]; then
    echo "Bringing up infra services..."
    pnpm infra:up >/tmp/zenops-demo-billing-infra.log 2>&1
  fi

  echo "Bootstrapping database..."
  env \
    DATABASE_URL_ROOT="$DATABASE_URL_ROOT" \
    DATABASE_URL="$DATABASE_URL" \
    POSTGRES_BIND_PORT="$POSTGRES_BIND_PORT" \
    pnpm bootstrap:db >/tmp/zenops-demo-billing-bootstrap.log 2>&1
}

assert_equals() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: ${label} expected=${expected} actual=${actual}"
    exit 1
  fi
}

main() {
  require_cmd curl
  require_cmd node
  require_cmd pnpm

  run_setup
  start_api_if_needed

  echo "Logging in as internal web user..."
  api_call "POST" "/auth/login" "" "{\"aud\":\"web\",\"tenant_id\":\"${ZENOPS_INTERNAL_TENANT_ID}\",\"user_id\":\"33333333-3333-3333-3333-333333333333\",\"sub\":\"33333333-3333-3333-3333-333333333333\",\"roles\":[\"accounts\"],\"capabilities\":[\"invoices.read\"]}"
  require_http_ok
  local token
  token="$(json_eval "$API_LAST_BODY" "data.access_token")"

  local due_date
  due_date="$(date -u +%F)"

  echo "Creating assignment..."
  api_call "POST" "/assignments" "$token" "{\"source\":\"tenant\",\"title\":\"Billing Demo Assignment $(date -u +%Y%m%d-%H%M%S)\",\"summary\":\"Finalize billing demo\",\"priority\":\"normal\",\"status\":\"requested\",\"due_date\":\"${due_date}\"}"
  require_http_ok
  local assignment_id
  assignment_id="$(json_eval "$API_LAST_BODY" "data.id")"

  echo "Creating report request..."
  api_call "POST" "/report-requests" "$token" "{\"tenant_id\":\"${ZENOPS_INTERNAL_TENANT_ID}\",\"assignment_id\":\"${assignment_id}\",\"title\":\"Billing Demo Report\"}"
  require_http_ok
  local report_request_id
  report_request_id="$(json_eval "$API_LAST_BODY" "data.id")"

  echo "Queueing draft..."
  api_call "POST" "/report-requests/${report_request_id}/queue-draft" "$token"
  require_http_ok

  echo "Finalizing report request (first call)..."
  api_call "POST" "/report-requests/${report_request_id}/finalize" "$token"
  require_http_ok

  echo "Fetching billing summary..."
  api_call "GET" "/billing/me" "$token"
  require_http_ok
  local usage_events_1 invoice_id_1 invoice_total_1
  usage_events_1="$(json_eval "$API_LAST_BODY" "data.current_period.usage_events")"
  invoice_id_1="$(json_eval "$API_LAST_BODY" "data.current_period.invoice.id")"
  invoice_total_1="$(json_eval "$API_LAST_BODY" "data.current_period.invoice.total_paise")"

  echo "Fetching invoice detail..."
  api_call "GET" "/billing/invoices/${invoice_id_1}" "$token"
  require_http_ok
  local line_count_1 invoice_detail_total_1
  line_count_1="$(json_eval "$API_LAST_BODY" "Array.isArray(data.lines) ? data.lines.length : -1")"
  invoice_detail_total_1="$(json_eval "$API_LAST_BODY" "data.total_paise")"

  echo "Checking assignment activity for report_finalized..."
  api_call "GET" "/assignments/${assignment_id}" "$token"
  require_http_ok
  local finalized_activity_count_1
  finalized_activity_count_1="$(json_eval "$API_LAST_BODY" "Array.isArray(data.activities) ? data.activities.filter((a) => a.type === 'report_finalized').length : 0")"

  assert_equals "$usage_events_1" "1" "usage events after first finalize"
  assert_equals "$line_count_1" "1" "invoice lines after first finalize"
  assert_equals "$invoice_detail_total_1" "$invoice_total_1" "invoice totals match"
  if [[ "$finalized_activity_count_1" -lt 1 ]]; then
    echo "FAIL: expected at least one report_finalized activity"
    exit 1
  fi

  echo "Finalizing report request (second call, idempotency check)..."
  api_call "POST" "/report-requests/${report_request_id}/finalize" "$token"
  require_http_ok

  echo "Re-fetching billing summary..."
  api_call "GET" "/billing/me" "$token"
  require_http_ok
  local usage_events_2 invoice_id_2 invoice_total_2
  usage_events_2="$(json_eval "$API_LAST_BODY" "data.current_period.usage_events")"
  invoice_id_2="$(json_eval "$API_LAST_BODY" "data.current_period.invoice.id")"
  invoice_total_2="$(json_eval "$API_LAST_BODY" "data.current_period.invoice.total_paise")"

  echo "Re-fetching invoice detail..."
  api_call "GET" "/billing/invoices/${invoice_id_2}" "$token"
  require_http_ok
  local line_count_2
  line_count_2="$(json_eval "$API_LAST_BODY" "Array.isArray(data.lines) ? data.lines.length : -1")"

  api_call "GET" "/assignments/${assignment_id}" "$token"
  require_http_ok
  local finalized_activity_count_2
  finalized_activity_count_2="$(json_eval "$API_LAST_BODY" "Array.isArray(data.activities) ? data.activities.filter((a) => a.type === 'report_finalized').length : 0")"

  assert_equals "$usage_events_2" "1" "usage events after second finalize"
  assert_equals "$line_count_2" "1" "invoice lines after second finalize"
  assert_equals "$invoice_id_2" "$invoice_id_1" "invoice id stable across retries"
  assert_equals "$invoice_total_2" "$invoice_total_1" "invoice total unchanged on retry"
  assert_equals "$finalized_activity_count_2" "$finalized_activity_count_1" "report_finalized activity not duplicated"

  echo
  echo "Billing Demo Summary"
  echo "  assignment_id: ${assignment_id}"
  echo "  report_request_id: ${report_request_id}"
  echo "  invoice_id: ${invoice_id_1}"
  echo "  usage_events: ${usage_events_2}"
  echo "  invoice_lines: ${line_count_2}"
  echo "  invoice_total_paise: ${invoice_total_2}"
  echo "PASS: finalize billing flow is idempotent and invoice state is stable."
}

main "$@"
