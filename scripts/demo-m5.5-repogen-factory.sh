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
REPOGEN_RELEASE_OVERRIDE="${REPOGEN_RELEASE_OVERRIDE:-1}"
REPOGEN_RELEASE_OVERRIDE_REASON="${REPOGEN_RELEASE_OVERRIDE_REASON:-Manual override for local demo run}"
REPOGEN_POLL_SECONDS="${REPOGEN_POLL_SECONDS:-60}"

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

echo "0) Login web factory operator"
WEB_TOKEN="$(login_token)"

echo "1) Create repogen work order"
api_call "POST" "/repogen/work-orders" "$WEB_TOKEN" '{
  "source_type":"TENANT",
  "report_type":"VALUATION",
  "bank_name":"State Bank of India",
  "bank_type":"SBI"
}'
require_ok
WO_ID="$(json_eval "$API_LAST_BODY" "data.work_order_id")"
echo "work_order_id=${WO_ID}"

echo "2) Patch contract to satisfy valuation readiness fields"
api_call "PATCH" "/repogen/work-orders/${WO_ID}/contract" "$WEB_TOKEN" '{
  "ruleset_version":"m5.4-v1",
  "patch":{
    "property":{"address":"Factory demo site","land_area":{"value":1200,"unit":"sqft"},"floors":[]},
    "valuation_inputs":{
      "guideline_rate_per_sqm":12000,
      "market_rate_input":{"value":1800,"unit":"sqft"},
      "land_value":2000000,
      "building_value":1500000,
      "depreciation_percent":10
    },
    "manual_fields":{"justification_text":"Demo justification placeholder"}
  }
}'
require_ok
SNAPSHOT_VERSION="$(json_eval "$API_LAST_BODY" "data.output_snapshot.version")"
echo "snapshot_version=${SNAPSHOT_VERSION}"

echo "3) Link 6 evidence metadata items (upload-first placeholder refs)"
EVIDENCE_BODY='{"items":['
for i in 1 2 3 4 5 6; do
  if [[ "$i" -gt 1 ]]; then
    EVIDENCE_BODY+=","
  fi
  EVIDENCE_BODY+="{\"evidence_type\":\"PHOTO\",\"doc_type\":\"OTHER\",\"file_ref\":\"demo://photo-${i}.jpg\",\"annexure_order\":${i},\"tags\":{\"category\":\"demo_photo_${i}\"}}"
done
EVIDENCE_BODY+=']}'
api_call "POST" "/repogen/work-orders/${WO_ID}/evidence/link" "$WEB_TOKEN" "$EVIDENCE_BODY"
require_ok
READINESS_AFTER_EVIDENCE="$(json_eval "$API_LAST_BODY" "data.readiness.completeness_score")"
echo "readiness_after_evidence=${READINESS_AFTER_EVIDENCE}"

echo "4) Transition to DATA_PENDING (acceptance billing reserve/invoice draft)"
api_call "POST" "/repogen/work-orders/${WO_ID}/status" "$WEB_TOKEN" '{"status":"EVIDENCE_PENDING","note":"demo evidence collected"}'
require_ok
api_call "POST" "/repogen/work-orders/${WO_ID}/status" "$WEB_TOKEN" '{"status":"DATA_PENDING","note":"demo factory accepted"}'
require_ok

echo "5) Transition to READY_FOR_RENDER (auto bridge -> pack/job)"
api_call "POST" "/repogen/work-orders/${WO_ID}/status" "$WEB_TOKEN" '{"status":"READY_FOR_RENDER","note":"demo ready for render"}'
require_ok
PACK_ID_FROM_STATUS="$(json_eval "$API_LAST_BODY" "data.pack_link?.pack?.id ?? ''")"
JOB_ID_FROM_STATUS="$(json_eval "$API_LAST_BODY" "data.pack_link?.generation_job?.id ?? ''")"
echo "pack_id_from_status=${PACK_ID_FROM_STATUS}"
echo "job_id_from_status=${JOB_ID_FROM_STATUS}"

echo "6) Poll pack/job until generation completes"
DEADLINE=$(( $(date +%s) + REPOGEN_POLL_SECONDS ))
PACK_JOB_STATUS=""
while true; do
  api_call "GET" "/repogen/work-orders/${WO_ID}/pack" "$WEB_TOKEN"
  require_ok
  PACK_JOB_STATUS="$(json_eval "$API_LAST_BODY" "data.generation_job?.status ?? ''")"
  PACK_ID="$(json_eval "$API_LAST_BODY" "data.pack?.id ?? ''")"
  ARTIFACT_COUNT="$(json_eval "$API_LAST_BODY" "data.pack?.artifacts?.length ?? 0")"
  echo "  job_status=${PACK_JOB_STATUS} pack_id=${PACK_ID} artifacts=${ARTIFACT_COUNT}"
  if [[ "$PACK_JOB_STATUS" == "completed" ]]; then
    break
  fi
  if [[ "$PACK_JOB_STATUS" == "failed" || "$PACK_JOB_STATUS" == "cancelled" ]]; then
    echo "Pack generation did not complete successfully"
    echo "$API_LAST_BODY"
    exit 1
  fi
  if [[ "$(date +%s)" -ge "$DEADLINE" ]]; then
    echo "Timed out waiting for repogen generation job to complete (queue/worker may be offline)"
    echo "$API_LAST_BODY"
    exit 1
  fi
  sleep 2
done

PACK_LINK_JSON="$API_LAST_BODY"
BILLING_MODE="$(json_eval "$PACK_LINK_JSON" "data.billing_gate_status?.mode ?? null")"
INVOICE_PAID="$(json_eval "$PACK_LINK_JSON" "data.billing_gate_status?.service_invoice_is_paid ?? null")"
RESERVATION_PRESENT="$(json_eval "$PACK_LINK_JSON" "data.billing_gate_status?.reservation_id_present ?? false")"
echo "billing_mode=${BILLING_MODE} invoice_paid=${INVOICE_PAID} reservation_present=${RESERVATION_PRESENT}"

echo "7) Release deliverables (manual click equivalent)"
RELEASE_IDEMPOTENCY="demo:repogen:release:${WO_ID}:$(date +%s)"
OVERRIDE_FLAG="false"
OVERRIDE_REASON_JSON=""
if [[ "$BILLING_MODE" == "POSTPAID" && "$INVOICE_PAID" != "true" ]]; then
  if [[ "$REPOGEN_RELEASE_OVERRIDE" == "1" ]]; then
    OVERRIDE_FLAG="true"
    OVERRIDE_REASON_ESCAPED="$(printf '%s' "$REPOGEN_RELEASE_OVERRIDE_REASON" | node -pe 'JSON.stringify(require("fs").readFileSync(0,"utf8"))')"
    OVERRIDE_REASON_JSON=",\"override_reason\":${OVERRIDE_REASON_ESCAPED}"
    echo "  postpaid invoice unpaid -> using override"
  else
    echo "  postpaid invoice unpaid -> expecting blocked release"
  fi
fi

api_call "POST" "/repogen/work-orders/${WO_ID}/release-deliverables" "$WEB_TOKEN" "{\"idempotency_key\":\"${RELEASE_IDEMPOTENCY}\",\"override\":${OVERRIDE_FLAG}${OVERRIDE_REASON_JSON}}"
require_ok
RELEASE_BLOCKED="$(json_eval "$API_LAST_BODY" "data.blocked")"
RELEASE_GATE_RESULT="$(json_eval "$API_LAST_BODY" "data.release.billing_gate_result")"
echo "release_blocked=${RELEASE_BLOCKED}"
echo "release_gate_result=${RELEASE_GATE_RESULT}"

echo "8) Fetch export bundle and final pack linkage"
api_call "GET" "/repogen/work-orders/${WO_ID}/export" "$WEB_TOKEN"
require_ok
EXPORT_HASH_FMV="$(json_eval "$API_LAST_BODY" "data.export_bundle.derived_json.computed_values.FMV ?? null")"
EXPORT_EVIDENCE_COUNT="$(json_eval "$API_LAST_BODY" "data.export_bundle.evidence_manifest.length")"
echo "export_fmv=${EXPORT_HASH_FMV}"
echo "export_evidence_count=${EXPORT_EVIDENCE_COUNT}"

api_call "GET" "/repogen/work-orders/${WO_ID}/pack" "$WEB_TOKEN"
require_ok
FINAL_ARTIFACTS="$(json_eval "$API_LAST_BODY" "data.pack?.artifacts?.length ?? 0")"
FINAL_RELEASES="$(json_eval "$API_LAST_BODY" "data.deliverable_releases?.length ?? 0")"
echo "final_artifact_count=${FINAL_ARTIFACTS}"
echo "final_release_records=${FINAL_RELEASES}"

echo "PASS"
echo "API_BASE_URL=${API_BASE_URL}"
echo "work_order_id=${WO_ID}"

