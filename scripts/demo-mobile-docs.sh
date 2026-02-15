#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_PORT="${API_PORT:-3000}"
API_BASE_URL="${API_BASE_URL:-}"
ZENOPS_V2_API_BASE_URL="${ZENOPS_V2_API_BASE_URL:-}"
source "$ROOT_DIR/scripts/lib/resolve-v2-api.sh"
apply_v2_api_base "must-exist"

WEB_TOKEN="${WEB_TOKEN:-}"
STUDIO_TOKEN="${STUDIO_TOKEN:-}"

if [[ -z "$WEB_TOKEN" || -z "$STUDIO_TOKEN" ]]; then
  echo "ERROR: set WEB_TOKEN and STUDIO_TOKEN"
  exit 1
fi

API_LAST_STATUS=""
API_LAST_BODY=""

api_call() {
  local method="$1"
  local path="$2"
  local token="$3"
  local body="${4:-}"
  local response

  if [[ -n "$body" ]]; then
    response="$(
      curl -sS -X "$method" \
        -H "authorization: Bearer $token" \
        -H 'content-type: application/json' \
        --data "$body" \
        -w $'\n%{http_code}' \
        "${API_BASE_URL}${path}"
    )"
  else
    response="$(
      curl -sS -X "$method" \
        -H "authorization: Bearer $token" \
        -w $'\n%{http_code}' \
        "${API_BASE_URL}${path}"
    )"
  fi

  API_LAST_STATUS="${response##*$'\n'}"
  API_LAST_BODY="${response%$'\n'*}"
}

require_ok() {
  if [[ "$API_LAST_STATUS" -lt 200 || "$API_LAST_STATUS" -gt 299 ]]; then
    echo "ERROR: request failed HTTP $API_LAST_STATUS"
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
const value = Function("d", `return (${expr});`)(data);
process.stdout.write(String(value));
' "$expr"
}

echo "1) create assignment"
due_date="$(date -u -v+2d +%Y-%m-%d 2>/dev/null || date -u -d '+2 days' +%Y-%m-%d)"
api_call "POST" "/assignments" "$WEB_TOKEN" "{\"source\":\"tenant\",\"title\":\"M4.4 mobile docs $(date -u +%Y%m%d-%H%M%S)\",\"priority\":\"normal\",\"status\":\"requested\",\"due_date\":\"${due_date}\"}"
require_ok
assignment_id="$(json_eval "$API_LAST_BODY" "d.id")"

echo "2) create/confirm one site-photo document (upload skipped in local demo)"
api_call "POST" "/files/presign-upload" "$WEB_TOKEN" "{\"purpose\":\"photo\",\"assignment_id\":\"${assignment_id}\",\"filename\":\"site-photo.jpg\",\"content_type\":\"image/jpeg\",\"size_bytes\":1024,\"source\":\"mobile_camera\",\"classification\":\"site_photo\",\"sensitivity\":\"internal\",\"taken_on_site\":true}"
require_ok
document_id="$(json_eval "$API_LAST_BODY" "d.document_id")"

api_call "POST" "/files/confirm-upload" "$WEB_TOKEN" "{\"document_id\":\"${document_id}\"}"
require_ok

echo "3) tag the document"
api_call "POST" "/documents/${document_id}/tags" "$WEB_TOKEN" '{"tags":[{"key":"classification","value":"site_photo"},{"key":"source","value":"mobile_camera"}]}'
require_ok

echo "4) verify it appears in assignment documents list"
api_call "GET" "/assignments/${assignment_id}" "$WEB_TOKEN"
require_ok
doc_count="$(json_eval "$API_LAST_BODY" "d.documents.length")"
if [[ "$doc_count" -lt 1 ]]; then
  echo "FAIL: assignment has no documents"
  exit 1
fi

echo "5) create manual WhatsApp outbox item"
api_call "POST" "/notifications/manual-whatsapp" "$STUDIO_TOKEN" '{"to":"whatsapp:+919999999999","message":"Demo manual WhatsApp from M4.4"}'
require_ok
manual_outbox_id="$(json_eval "$API_LAST_BODY" "d.id")"

echo "PASS"
echo "assignment_id=${assignment_id}"
echo "document_id=${document_id}"
echo "manual_outbox_id=${manual_outbox_id}"
