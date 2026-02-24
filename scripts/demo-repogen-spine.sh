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
WEB_USER_ID="${WEB_USER_ID:-33333333-3333-3333-3333-333333333333}"
REPOGEN_DEMO_DOCUMENT_ID="${REPOGEN_DEMO_DOCUMENT_ID:-}"

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
  api_call "POST" "/auth/login" "" "{\"aud\":\"web\",\"tenant_id\":\"${INTERNAL_TENANT_ID}\",\"user_id\":\"${WEB_USER_ID}\",\"sub\":\"${WEB_USER_ID}\",\"roles\":[\"super_admin\"],\"capabilities\":[\"*\"]}"
  require_ok
  json_eval "$API_LAST_BODY" "data.access_token"
}

echo "0) login web actor"
WEB_TOKEN="$(login_token)"

echo "1) create repogen work order"
api_call "POST" "/repogen/work-orders" "$WEB_TOKEN" '{
  "source_type":"TENANT",
  "report_type":"VALUATION",
  "bank_name":"State Bank of India",
  "bank_type":"SBI"
}'
require_ok
WO_ID="$(json_eval "$API_LAST_BODY" "data.work_order_id")"
echo "work_order_id=${WO_ID}"

echo "2) patch contract (creates snapshots + rules run + placeholder worker hook)"
api_call "PATCH" "/repogen/work-orders/${WO_ID}/contract" "$WEB_TOKEN" '{
  "ruleset_version":"m5.4-v1",
  "patch":{
    "property":{"address":"Demo site","land_area":{"value":1000,"unit":"sqft"},"floors":[]},
    "valuation_inputs":{
      "guideline_rate_input":{"value":1500,"unit":"sqft"},
      "market_rate_input":{"value":2000,"unit":"sqft"},
      "land_value":2000000,
      "building_value":3000000
    }
  }
}'
require_ok
SNAPSHOT_VERSION="$(json_eval "$API_LAST_BODY" "data.output_snapshot?.version ?? null")"
echo "output_snapshot_version=${SNAPSHOT_VERSION}"

echo "3) get detail (readiness + derived values)"
api_call "GET" "/repogen/work-orders/${WO_ID}" "$WEB_TOKEN"
require_ok
READINESS="$(json_eval "$API_LAST_BODY" "data.readiness.completeness_score")"
echo "readiness_score=${READINESS}"

echo "4) optional evidence link (set REPOGEN_DEMO_DOCUMENT_ID to run this step)"
if [[ -n "$REPOGEN_DEMO_DOCUMENT_ID" ]]; then
  api_call "POST" "/repogen/work-orders/${WO_ID}/evidence/link" "$WEB_TOKEN" "{\"items\":[{\"evidence_type\":\"PHOTO\",\"doc_type\":\"OTHER\",\"document_id\":\"${REPOGEN_DEMO_DOCUMENT_ID}\",\"annexure_order\":1}]}"
  require_ok
  echo "linked_document_id=${REPOGEN_DEMO_DOCUMENT_ID}"
else
  echo "skip (no REPOGEN_DEMO_DOCUMENT_ID provided)"
fi

echo "5) export deterministic bundle JSON"
api_call "GET" "/repogen/work-orders/${WO_ID}/export" "$WEB_TOKEN"
require_ok
FMV="$(json_eval "$API_LAST_BODY" "data.export_bundle.derived_json.computed_values.FMV")"
EVIDENCE_COUNT="$(json_eval "$API_LAST_BODY" "data.export_bundle.evidence_manifest.length")"
echo "fmv=${FMV}"
echo "evidence_manifest_count=${EVIDENCE_COUNT}"

echo "6) status transitions (DRAFT -> EVIDENCE_PENDING -> DATA_PENDING)"
api_call "POST" "/repogen/work-orders/${WO_ID}/status" "$WEB_TOKEN" '{"status":"EVIDENCE_PENDING","note":"demo evidence collection"}'
require_ok
api_call "POST" "/repogen/work-orders/${WO_ID}/status" "$WEB_TOKEN" '{"status":"DATA_PENDING","note":"demo accepted into production"}'
require_ok

if [[ -n "$REPOGEN_DEMO_DOCUMENT_ID" ]]; then
  echo "7) try READY_FOR_RENDER (may still fail if readiness requirements are unmet)"
  set +e
  api_call "POST" "/repogen/work-orders/${WO_ID}/status" "$WEB_TOKEN" '{"status":"READY_FOR_RENDER","note":"demo ready attempt"}'
  set -e
  echo "ready_for_render_status_http=${API_LAST_STATUS}"
  echo "$API_LAST_BODY"
fi

echo "PASS"
echo "API_BASE_URL=${API_BASE_URL}"
echo "work_order_id=${WO_ID}"
