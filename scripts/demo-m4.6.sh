#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_PORT="${API_PORT:-3000}"
API_BASE_URL="${API_BASE_URL:-}"
ZENOPS_V2_API_BASE_URL="${ZENOPS_V2_API_BASE_URL:-}"
source "$ROOT_DIR/scripts/lib/resolve-v2-api.sh"
apply_v2_api_base "must-exist"

INTERNAL_TENANT_ID="${ZENOPS_INTERNAL_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
EXTERNAL_TENANT_ID="${ZENOPS_EXTERNAL_TENANT_ID:-22222222-2222-2222-2222-222222222222}"
WEB_USER_ID="${WEB_USER_ID:-33333333-3333-3333-3333-333333333333}"
STUDIO_USER_ID="${STUDIO_USER_ID:-44444444-4444-4444-4444-444444444444}"
DEMO_NAMESPACE="${DEMO_NAMESPACE:-m46-demo}"

API_LAST_STATUS=""
API_LAST_BODY=""

api_call() {
  local method="$1"
  local path="$2"
  local token="${3:-}"
  local body="${4:-}"
  local response
  local -a headers=()

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

require_ok() {
  if [[ "$API_LAST_STATUS" -lt 200 || "$API_LAST_STATUS" -gt 299 ]]; then
    echo "ERROR HTTP $API_LAST_STATUS"
    echo "$API_LAST_BODY"
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
if (typeof out === "object") process.stdout.write(JSON.stringify(out));
else process.stdout.write(String(out));
' "$expr"
}

login_token() {
  local aud="$1"
  local tenant_id="$2"
  local user_id="$3"
  local roles_json="$4"
  local caps_json="$5"

  api_call "POST" "/auth/login" "" "{\"aud\":\"${aud}\",\"tenant_id\":\"${tenant_id}\",\"user_id\":\"${user_id}\",\"sub\":\"${user_id}\",\"roles\":${roles_json},\"capabilities\":${caps_json}}"
  require_ok
  json_eval "$API_LAST_BODY" "data.access_token"
}

echo "0) login demo actors"
WEB_TOKEN="$(login_token "web" "$INTERNAL_TENANT_ID" "$WEB_USER_ID" '["super_admin"]' '["*"]')"
PORTAL_TOKEN="$(login_token "portal" "$EXTERNAL_TENANT_ID" "$WEB_USER_ID" '["portal_user"]' '[]')"
STUDIO_EXTERNAL_TOKEN="$(login_token "studio" "$EXTERNAL_TENANT_ID" "$STUDIO_USER_ID" '["super_admin"]' '["*"]')"

ts="$(date -u +%Y%m%d-%H%M%S)"

echo "1) create-or-reuse bank + branch + channel"
bank_name="${DEMO_NAMESPACE}-bank"
branch_name="${DEMO_NAMESPACE}-branch"
channel_name="${DEMO_NAMESPACE}-referral-channel"
portal_channel_name="${DEMO_NAMESPACE}-portal-referral-channel"

api_call "POST" "/banks" "$WEB_TOKEN" "{\"name\":\"${bank_name}\",\"code\":\"M46DEMO\"}"
require_ok
bank_id="$(json_eval "$API_LAST_BODY" "data.id")"

api_call "POST" "/bank-branches" "$WEB_TOKEN" "{\"bank_id\":\"${bank_id}\",\"branch_name\":\"${branch_name}\",\"city\":\"Belgaum\",\"state\":\"Karnataka\",\"ifsc\":\"M46DEMO\"}"
require_ok
branch_id="$(json_eval "$API_LAST_BODY" "data.id")"

api_call "POST" "/channels" "$WEB_TOKEN" "{\"name\":\"${channel_name}\",\"city\":\"Mudhol\",\"channel_type\":\"AGENT\",\"commission_mode\":\"PERCENT\",\"commission_value\":2,\"is_active\":true}"
require_ok
channel_id="$(json_eval "$API_LAST_BODY" "data.id")"

echo "2) create assignment with source_type=BANK"
due_date="$(date -u -v+3d +%Y-%m-%d 2>/dev/null || date -u -d '+3 days' +%Y-%m-%d)"
api_call "POST" "/assignments" "$WEB_TOKEN" "{\"source\":\"tenant\",\"source_type\":\"bank\",\"bank_id\":\"${bank_id}\",\"bank_branch_id\":\"${branch_id}\",\"channel_id\":\"${channel_id}\",\"title\":\"M4.6 Assignment ${ts}\",\"summary\":\"Demo flow\",\"priority\":\"normal\",\"status\":\"requested\",\"due_date\":\"${due_date}\"}"
require_ok
assignment_id="$(json_eval "$API_LAST_BODY" "data.id")"

echo "3) move assignment DRAFT -> COLLECTING"
api_call "POST" "/assignments/${assignment_id}/status" "$WEB_TOKEN" '{"to_status":"COLLECTING","note":"collecting started"}'
require_ok

api_call "GET" "/assignments/${assignment_id}/status-history" "$WEB_TOKEN"
require_ok
history_count="$(json_eval "$API_LAST_BODY" "Array.isArray(data) ? data.length : 0")"
if [[ "$history_count" -lt 1 ]]; then
  echo "FAIL: no status history rows"
  exit 1
fi

echo "4) create task assigned to admin"
api_call "POST" "/tasks" "$WEB_TOKEN" "{\"assignment_id\":\"${assignment_id}\",\"title\":\"M4.6 Task ${ts}\",\"status\":\"OPEN\",\"priority\":\"MEDIUM\",\"assigned_to_user_id\":\"${WEB_USER_ID}\"}"
require_ok
task_id="$(json_eval "$API_LAST_BODY" "data.id")"

echo "5) mark task done"
api_call "POST" "/tasks/${task_id}/mark-done" "$WEB_TOKEN"
require_ok

echo "6) create portal referral channel request and accept"
api_call "POST" "/channels" "$PORTAL_TOKEN" "{\"name\":\"${portal_channel_name}\",\"city\":\"Mudhol\",\"channel_type\":\"AGENT\",\"commission_mode\":\"PERCENT\",\"commission_value\":1,\"is_active\":true}"
require_ok
portal_channel_id="$(json_eval "$API_LAST_BODY" "data.id")"

api_call "POST" "/channel-requests" "$PORTAL_TOKEN" "{\"channel_id\":\"${portal_channel_id}\",\"borrower_name\":\"Borrower ${ts}\",\"phone\":\"+919999999999\",\"property_city\":\"Belgaum\",\"property_address\":\"Demo address\",\"notes\":\"M4.6 portal request\"}"
require_ok
channel_request_id="$(json_eval "$API_LAST_BODY" "data.id")"

api_call "POST" "/channel-requests/${channel_request_id}/status" "$STUDIO_EXTERNAL_TOKEN" '{"status":"ACCEPTED","note":"accepted from demo"}'
require_ok
accepted_assignment_id="$(json_eval "$API_LAST_BODY" "data.assignment_id")"
if [[ -z "$accepted_assignment_id" || "$accepted_assignment_id" == "null" ]]; then
  echo "FAIL: accepted channel request did not create assignment"
  exit 1
fi

echo "PASS"
echo "bank_id=${bank_id}"
echo "branch_id=${branch_id}"
echo "channel_id=${channel_id}"
echo "assignment_id=${assignment_id}"
echo "task_id=${task_id}"
echo "channel_request_id=${channel_request_id}"
echo "accepted_assignment_id=${accepted_assignment_id}"
