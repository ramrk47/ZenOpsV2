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
OCR_POLL_SECONDS="${OCR_POLL_SECONDS:-45}"

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
  api_call "POST" "/auth/login" "" "{\"aud\":\"web\",\"tenant_id\":\"${INTERNAL_TENANT_ID}\",\"user_id\":\"${WEB_USER_ID}\",\"sub\":\"${WEB_USER_ID}\",\"roles\":[\"super_admin\",\"repogen_factory\"],\"capabilities\":[\"*\"]}"
  require_ok
  json_eval "$API_LAST_BODY" "data.access_token"
}

echo "0) Login web operator"
WEB_TOKEN="$(login_token)"

echo "1) Create valuation work order"
api_call "POST" "/repogen/work-orders" "$WEB_TOKEN" '{
  "source_type":"TENANT",
  "report_type":"VALUATION",
  "bank_name":"State Bank of India",
  "bank_type":"SBI"
}'
require_ok
WO_ID="$(json_eval "$API_LAST_BODY" "data.work_order_id")"
echo "work_order_id=${WO_ID}"

echo "2) Patch contract (create snapshots + rules + readiness)"
api_call "PATCH" "/repogen/work-orders/${WO_ID}/contract" "$WEB_TOKEN" '{
  "ruleset_version":"m5.4-v1",
  "patch":{
    "property":{"address":"M5.6 demo site","land_area":{"value":1200,"unit":"sqft"},"floors":[]},
    "valuation_inputs":{
      "guideline_rate_per_sqm":12000,
      "market_rate_input":{"value":1800,"unit":"sqft"},
      "land_value":2000000,
      "building_value":1500000,
      "depreciation_percent":10
    },
    "manual_fields":{"justification_text":"M5.6 demo placeholder"}
  }
}'
require_ok
SNAPSHOT_VERSION="$(json_eval "$API_LAST_BODY" "data.output_snapshot.version")"
echo "snapshot_version=${SNAPSHOT_VERSION}"

echo "3) Inspect evidence profiles / checklist (default should auto-select)"
api_call "GET" "/repogen/work-orders/${WO_ID}/evidence-profiles" "$WEB_TOKEN"
require_ok
PROFILE_ID="$(json_eval "$API_LAST_BODY" "data.selected_profile_id")"
CHECKLIST_COUNT="$(json_eval "$API_LAST_BODY" "data.checklist.length")"
MISSING_CHECKLIST="$(json_eval "$API_LAST_BODY" "data.checklist.filter(i => !i.satisfied).length")"
echo "selected_profile_id=${PROFILE_ID}"
echo "checklist_items=${CHECKLIST_COUNT}"
echo "checklist_missing=${MISSING_CHECKLIST}"

echo "4) Link evidence metadata to satisfy default valuation checklist"
EVIDENCE_BODY='{"items":['
add_item() {
  local json="$1"
  if [[ "$EVIDENCE_BODY" != '{"items":[' ]]; then
    EVIDENCE_BODY+="," 
  fi
  EVIDENCE_BODY+="$json"
}
add_item '{"evidence_type":"DOCUMENT","doc_type":"SALE_DEED","file_ref":"demo://sale_deed.pdf"}'
add_item '{"evidence_type":"DOCUMENT","doc_type":"RTC","file_ref":"demo://rtc.pdf"}'
add_item '{"evidence_type":"DOCUMENT","doc_type":"EC","file_ref":"demo://ec.pdf"}'
add_item '{"evidence_type":"DOCUMENT","doc_type":"KHATA","file_ref":"demo://khata.pdf"}'
add_item '{"evidence_type":"DOCUMENT","doc_type":"TAX","file_ref":"demo://tax.pdf"}'
add_item '{"evidence_type":"DOCUMENT","doc_type":"PLAN","file_ref":"demo://plan.pdf"}'
add_item '{"evidence_type":"PHOTO","doc_type":"OTHER","file_ref":"demo://ext-1.jpg","tags":{"category":"exterior"}}'
add_item '{"evidence_type":"PHOTO","doc_type":"OTHER","file_ref":"demo://ext-2.jpg","tags":{"category":"exterior"}}'
add_item '{"evidence_type":"PHOTO","doc_type":"OTHER","file_ref":"demo://int-1.jpg","tags":{"category":"interior"}}'
add_item '{"evidence_type":"PHOTO","doc_type":"OTHER","file_ref":"demo://int-2.jpg","tags":{"category":"interior"}}'
add_item '{"evidence_type":"PHOTO","doc_type":"OTHER","file_ref":"demo://surroundings.jpg","tags":{"category":"surroundings"}}'
add_item '{"evidence_type":"GEO","doc_type":"OTHER","file_ref":"demo://gps.jpg","tags":{"category":"gps"}}'
add_item '{"evidence_type":"SCREENSHOT","doc_type":"OTHER","file_ref":"demo://google-map.png","tags":{"category":"google_map"}}'
add_item '{"evidence_type":"SCREENSHOT","doc_type":"OTHER","file_ref":"demo://route-map.png","tags":{"category":"route_map"}}'
EVIDENCE_BODY+=']}'
api_call "POST" "/repogen/work-orders/${WO_ID}/evidence/link" "$WEB_TOKEN" "$EVIDENCE_BODY"
require_ok
echo "readiness_after_evidence=$(json_eval "$API_LAST_BODY" "data.readiness.completeness_score")"

echo "5) Link required fields to evidence (manual audit-grade mapping)"
api_call "GET" "/repogen/work-orders/${WO_ID}/field-evidence-links" "$WEB_TOKEN"
require_ok
LATEST_SNAPSHOT_ID="$(json_eval "$API_LAST_BODY" "data.latest_snapshot_id")"
if [[ -z "$LATEST_SNAPSHOT_ID" || "$LATEST_SNAPSHOT_ID" == "null" ]]; then
  echo "No latest snapshot id available for field linking"
  exit 1
fi

api_call "GET" "/repogen/work-orders/${WO_ID}" "$WEB_TOKEN"
require_ok
FIRST_EVIDENCE_ID="$(json_eval "$API_LAST_BODY" "data.evidence_items[0].id")"
SECOND_EVIDENCE_ID="$(json_eval "$API_LAST_BODY" "data.evidence_items[1].id")"
THIRD_EVIDENCE_ID="$(json_eval "$API_LAST_BODY" "data.evidence_items[2].id")"

api_call "POST" "/repogen/work-orders/${WO_ID}/field-evidence-links" "$WEB_TOKEN" "{\"links\":[
  {\"snapshot_id\":\"${LATEST_SNAPSHOT_ID}\",\"field_key\":\"party.bank_name\",\"evidence_item_id\":\"${FIRST_EVIDENCE_ID}\",\"confidence\":0.9},
  {\"snapshot_id\":\"${LATEST_SNAPSHOT_ID}\",\"field_key\":\"property.address\",\"evidence_item_id\":\"${SECOND_EVIDENCE_ID}\",\"confidence\":0.9},
  {\"snapshot_id\":\"${LATEST_SNAPSHOT_ID}\",\"field_key\":\"property.land_area\",\"evidence_item_id\":\"${THIRD_EVIDENCE_ID}\",\"confidence\":0.85},
  {\"snapshot_id\":\"${LATEST_SNAPSHOT_ID}\",\"field_key\":\"valuation_inputs.rate\",\"evidence_item_id\":\"${THIRD_EVIDENCE_ID}\",\"confidence\":0.8}
]}"
require_ok
FIELD_LINK_COUNT="$(json_eval "$API_LAST_BODY" "data.links.length")"
echo "field_link_count=${FIELD_LINK_COUNT}"

echo "6) Enqueue OCR placeholder for one evidence item"
api_call "POST" "/repogen/work-orders/${WO_ID}/ocr/enqueue" "$WEB_TOKEN" "{\"evidence_item_id\":\"${FIRST_EVIDENCE_ID}\"}"
require_ok
OCR_JOB_ID="$(json_eval "$API_LAST_BODY" "data.ocr_job.id")"
echo "ocr_job_id=${OCR_JOB_ID}"

echo "7) Poll work-order detail for OCR placeholder completion"
DEADLINE=$(( $(date +%s) + OCR_POLL_SECONDS ))
OCR_STATUS=""
while true; do
  api_call "GET" "/repogen/work-orders/${WO_ID}" "$WEB_TOKEN"
  require_ok
  OCR_STATUS="$(json_eval "$API_LAST_BODY" "(data.ocr_jobs || []).find(j => j.id === '${OCR_JOB_ID}')?.status ?? ''")"
  echo "  ocr_status=${OCR_STATUS:-UNKNOWN}"
  if [[ "$OCR_STATUS" == "DONE" ]]; then
    break
  fi
  if [[ "$OCR_STATUS" == "FAILED" ]]; then
    echo "$API_LAST_BODY"
    exit 1
  fi
  if [[ "$(date +%s)" -ge "$DEADLINE" ]]; then
    echo "Timed out waiting for OCR placeholder worker (queue/worker may be offline)"
    echo "$API_LAST_BODY"
    exit 1
  fi
  sleep 2
done

echo "8) Re-check checklist and readiness"
api_call "GET" "/repogen/work-orders/${WO_ID}/evidence-profiles" "$WEB_TOKEN"
require_ok
CHECKLIST_MISSING_AFTER="$(json_eval "$API_LAST_BODY" "data.checklist.filter(i => !i.satisfied).length")"
echo "checklist_missing_after=${CHECKLIST_MISSING_AFTER}"

api_call "GET" "/repogen/work-orders/${WO_ID}" "$WEB_TOKEN"
require_ok
READINESS_SCORE="$(json_eval "$API_LAST_BODY" "data.readiness.completeness_score")"
MISSING_EVIDENCE_COUNT="$(json_eval "$API_LAST_BODY" "data.readiness.missing_evidence.length")"
FIELD_LINK_WARN_COUNT="$(json_eval "$API_LAST_BODY" "(data.readiness.missing_field_evidence_links || []).length")"
echo "readiness_score=${READINESS_SCORE}"
echo "missing_evidence_count=${MISSING_EVIDENCE_COUNT}"
echo "missing_field_evidence_links=${FIELD_LINK_WARN_COUNT}"

echo "9) Transition through factory statuses (reserve on DATA_PENDING preserved)"
api_call "POST" "/repogen/work-orders/${WO_ID}/status" "$WEB_TOKEN" '{"status":"EVIDENCE_PENDING","note":"m5.6 evidence demo"}'
require_ok
api_call "POST" "/repogen/work-orders/${WO_ID}/status" "$WEB_TOKEN" '{"status":"DATA_PENDING","note":"m5.6 factory accept demo"}'
require_ok
api_call "POST" "/repogen/work-orders/${WO_ID}/status" "$WEB_TOKEN" '{"status":"READY_FOR_RENDER","note":"m5.6 readiness profile satisfied"}'
require_ok
echo "status_after_ready=$(json_eval "$API_LAST_BODY" "data.work_order.status")"

echo "PASS"
echo "API_BASE_URL=${API_BASE_URL}"
echo "work_order_id=${WO_ID}"
echo "ocr_job_id=${OCR_JOB_ID}"
