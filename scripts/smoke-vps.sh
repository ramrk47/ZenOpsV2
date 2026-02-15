#!/usr/bin/env bash
set -euo pipefail

normalize_api_base() {
  local base="${1%/}"
  if [[ "${base}" == */v1 ]]; then
    printf '%s' "${base}"
  else
    printf '%s/v1' "${base}"
  fi
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: required command not found: $1" >&2
    exit 1
  }
}

require_cmd curl
require_cmd jq

V2_API_RAW="${V2_API_BASE_URL:-${ZENOPS_V2_API_BASE_URL:-http://127.0.0.1:3000}}"
V1_API_RAW="${V1_API_BASE_URL:-${ZENOPS_V1_API_BASE_URL:-http://127.0.0.1:8000}}"
V2_API_BASE="$(normalize_api_base "${V2_API_RAW}")"
V1_API_BASE="$(normalize_api_base "${V1_API_RAW}")"

TOKEN="${STUDIO_BEARER_TOKEN:-${STUDIO_ADMIN_TOKEN:-}}"
if [[ -z "${TOKEN}" ]]; then
  echo "ERROR: set STUDIO_BEARER_TOKEN (or STUDIO_ADMIN_TOKEN) before running smoke." >&2
  exit 1
fi

AUTH_HEADER=(-H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json")

check_identity() {
  local base="$1"
  local expected_app="$2"

  local meta
  meta="$(curl -fsS "${base}/meta")"
  local app
  app="$(printf '%s' "${meta}" | jq -r '.app // empty')"

  if [[ -n "${expected_app}" && "${app}" != "${expected_app}" ]]; then
    echo "ERROR: unexpected app identity for ${base}. expected=${expected_app} got=${app}" >&2
    exit 1
  fi

  curl -fsS "${base}/health" | jq '.' >/dev/null
}

echo "[smoke-vps] V2 API base: ${V2_API_BASE}"
echo "[smoke-vps] V1 API base: ${V1_API_BASE}"

check_identity "${V2_API_BASE}" "zenops-v2"
check_identity "${V1_API_BASE}" "zenops-v1"

TENANT_ID="${ZENOPS_INTERNAL_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
SUFFIX="$(date +%s)"
EXTERNAL_KEY="v2:external:vps-smoke-${SUFFIX}"

ACCOUNT_PAYLOAD="$(jq -n \
  --arg tenant_id "${TENANT_ID}" \
  --arg external_key "${EXTERNAL_KEY}" \
  '{tenant_id: $tenant_id, account_type: "external_associate", display_name: "VPS Smoke Account", external_key: $external_key, payment_terms_days: 15}'
)"

echo "[smoke-vps] create billing account"
ACCOUNT_STATUS="$(curl -fsS "${AUTH_HEADER[@]}" -X POST "${V2_API_BASE}/control/accounts" -d "${ACCOUNT_PAYLOAD}")"
ACCOUNT_ID="$(printf '%s' "${ACCOUNT_STATUS}" | jq -r '.account_id')"
if [[ -z "${ACCOUNT_ID}" || "${ACCOUNT_ID}" == "null" ]]; then
  echo "ERROR: unable to resolve account_id from control/accounts response" >&2
  exit 1
fi

echo "[smoke-vps] grant credits + enable CREDIT mode"
GRANT_KEY="vps-smoke-grant-${SUFFIX}"
curl -fsS "${AUTH_HEADER[@]}" -X POST "${V2_API_BASE}/control/accounts/${ACCOUNT_ID}/credits/grant" -d "$(jq -n --arg key "${GRANT_KEY}" '{amount:3, reason:"grant", ref_type:"smoke", ref_id:"vps", idempotency_key:$key}')" >/dev/null
curl -fsS "${AUTH_HEADER[@]}" -X PATCH "${V2_API_BASE}/control/accounts/${ACCOUNT_ID}/policy" -d '{"billing_mode":"credit","payment_terms_days":15,"currency":"INR","is_enabled":true}' >/dev/null

echo "[smoke-vps] reserve + consume"
RESERVE_CONSUME_KEY="vps-smoke-reserve-consume-${SUFFIX}"
RESERVE_CONSUME="$(curl -fsS "${AUTH_HEADER[@]}" -X POST "${V2_API_BASE}/control/credits/reserve" -d "$(jq -n --arg account_id "${ACCOUNT_ID}" --arg key "${RESERVE_CONSUME_KEY}" '{account_id:$account_id, amount:1, ref_type:"smoke", ref_id:"vps-consume", idempotency_key:$key}')")"
RESERVE_CONSUME_ID="$(printf '%s' "${RESERVE_CONSUME}" | jq -r '.id')"
if [[ -z "${RESERVE_CONSUME_ID}" || "${RESERVE_CONSUME_ID}" == "null" ]]; then
  echo "ERROR: reserve for consume flow failed" >&2
  exit 1
fi

CONSUME_KEY="vps-smoke-consume-${SUFFIX}"
curl -fsS "${AUTH_HEADER[@]}" -X POST "${V2_API_BASE}/control/credits/consume" -d "$(jq -n --arg account_id "${ACCOUNT_ID}" --arg reservation_id "${RESERVE_CONSUME_ID}" --arg key "${CONSUME_KEY}" '{account_id:$account_id, reservation_id:$reservation_id, idempotency_key:$key}')" >/dev/null

echo "[smoke-vps] reserve + release"
RESERVE_RELEASE_KEY="vps-smoke-reserve-release-${SUFFIX}"
RESERVE_RELEASE="$(curl -fsS "${AUTH_HEADER[@]}" -X POST "${V2_API_BASE}/control/credits/reserve" -d "$(jq -n --arg account_id "${ACCOUNT_ID}" --arg key "${RESERVE_RELEASE_KEY}" '{account_id:$account_id, amount:1, ref_type:"smoke", ref_id:"vps-release", idempotency_key:$key}')")"
RESERVE_RELEASE_ID="$(printf '%s' "${RESERVE_RELEASE}" | jq -r '.id')"
if [[ -z "${RESERVE_RELEASE_ID}" || "${RESERVE_RELEASE_ID}" == "null" ]]; then
  echo "ERROR: reserve for release flow failed" >&2
  exit 1
fi

RELEASE_KEY="vps-smoke-release-${SUFFIX}"
curl -fsS "${AUTH_HEADER[@]}" -X POST "${V2_API_BASE}/control/credits/release" -d "$(jq -n --arg account_id "${ACCOUNT_ID}" --arg reservation_id "${RESERVE_RELEASE_ID}" --arg key "${RELEASE_KEY}" '{account_id:$account_id, reservation_id:$reservation_id, idempotency_key:$key}')" >/dev/null

echo "[smoke-vps] reconcile dry-run"
curl -fsS "${AUTH_HEADER[@]}" -X POST "${V2_API_BASE}/control/credits/reconcile" -d "$(jq -n --arg tenant_id "${TENANT_ID}" '{tenant_id:$tenant_id, dry_run:true, limit:50}')" >/dev/null

echo "[smoke-vps] switch to POSTPAID and validate invoice flow"
curl -fsS "${AUTH_HEADER[@]}" -X PATCH "${V2_API_BASE}/control/accounts/${ACCOUNT_ID}/policy" -d '{"billing_mode":"postpaid","payment_terms_days":15,"currency":"INR","is_enabled":true}' >/dev/null

INVOICE_CREATE="$(curl -fsS "${AUTH_HEADER[@]}" -X POST "${V2_API_BASE}/service-invoices" -d "$(jq -n --arg account_id "${ACCOUNT_ID}" '{account_id:$account_id, notes:"vps smoke invoice", items:[{description:"Smoke service",quantity:1,unit_price:299.00,order_index:0}] }')")"
INVOICE_ID="$(printf '%s' "${INVOICE_CREATE}" | jq -r '.id')"
if [[ -z "${INVOICE_ID}" || "${INVOICE_ID}" == "null" ]]; then
  echo "ERROR: unable to create service invoice" >&2
  exit 1
fi

ISSUE_KEY="vps-smoke-issue-${SUFFIX}"
MARK_PAID_KEY="vps-smoke-mark-paid-${SUFFIX}"
curl -fsS "${AUTH_HEADER[@]}" -H "Idempotency-Key: ${ISSUE_KEY}" -X POST "${V2_API_BASE}/service-invoices/${INVOICE_ID}/issue" -d '{}' >/dev/null
curl -fsS "${AUTH_HEADER[@]}" -H "Idempotency-Key: ${MARK_PAID_KEY}" -X POST "${V2_API_BASE}/service-invoices/${INVOICE_ID}/mark-paid" -d '{"mode":"manual","notes":"vps smoke payment"}' >/dev/null
curl -fsS "${AUTH_HEADER[@]}" -H "Idempotency-Key: ${MARK_PAID_KEY}" -X POST "${V2_API_BASE}/service-invoices/${INVOICE_ID}/mark-paid" -d '{"mode":"manual","notes":"vps smoke payment"}' >/dev/null

if [[ -n "${STUDIO_SERVICE_TOKEN:-}" ]]; then
  echo "[smoke-vps] trigger due subscription refill scan via service token"
  curl -fsS -X POST "${V2_API_BASE}/billing/subscriptions/refill-due" \
    -H "x-service-token: ${STUDIO_SERVICE_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"limit":50,"dry_run":true}' >/dev/null
fi

echo "[smoke-vps] success"
