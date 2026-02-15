#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=./lib/resolve-v2-api.sh
source "${ROOT_DIR}/scripts/lib/resolve-v2-api.sh"

apply_v2_api_base must-exist

API_BASE_URL="${ZENOPS_V2_API_BASE_URL}"
TOKEN="${STUDIO_BEARER_TOKEN:-${STUDIO_ADMIN_TOKEN:-}}"

if [[ -z "${TOKEN}" ]]; then
  echo "ERROR: set STUDIO_BEARER_TOKEN (or STUDIO_ADMIN_TOKEN) before running smoke." >&2
  exit 1
fi

AUTH_HEADER=( -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" )

echo "[smoke-v2] API base: ${API_BASE_URL}"

echo "[smoke-v2] identity check"
curl -fsS "${API_BASE_URL}/meta" | jq '.' >/dev/null
curl -fsS "${API_BASE_URL}/health" | jq '.' >/dev/null

TENANT_ID="${ZENOPS_INTERNAL_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
SUFFIX="$(date +%s)"
EXTERNAL_KEY="v2:external:smoke-${SUFFIX}"

ACCOUNT_PAYLOAD="$(jq -n \
  --arg tenant_id "${TENANT_ID}" \
  --arg external_key "${EXTERNAL_KEY}" \
  '{tenant_id: $tenant_id, account_type: "external_associate", display_name: "Smoke Account", external_key: $external_key, payment_terms_days: 15}'
)"

echo "[smoke-v2] create/upsert account"
ACCOUNT_STATUS="$(curl -fsS "${AUTH_HEADER[@]}" -X POST "${API_BASE_URL}/control/accounts" -d "${ACCOUNT_PAYLOAD}")"
ACCOUNT_ID="$(printf '%s' "${ACCOUNT_STATUS}" | jq -r '.account_id')"

if [[ -z "${ACCOUNT_ID}" || "${ACCOUNT_ID}" == "null" ]]; then
  echo "ERROR: unable to resolve account_id from control/accounts response" >&2
  exit 1
fi

echo "[smoke-v2] set CREDIT policy"
curl -fsS "${AUTH_HEADER[@]}" -X PATCH "${API_BASE_URL}/control/accounts/${ACCOUNT_ID}/policy" -d '{"billing_mode":"credit","payment_terms_days":15,"currency":"INR","is_enabled":true}' >/dev/null

echo "[smoke-v2] grant credits"
GRANT_KEY="smoke-grant-${SUFFIX}"
curl -fsS "${AUTH_HEADER[@]}" -X POST "${API_BASE_URL}/control/accounts/${ACCOUNT_ID}/credits/grant" -d "$(jq -n --arg key "${GRANT_KEY}" '{amount:2, reason:"grant", ref_type:"smoke", ref_id:"smoke", idempotency_key:$key}')" >/dev/null

echo "[smoke-v2] reserve + consume credits"
RESERVE_KEY="smoke-reserve-consume-${SUFFIX}"
RESERVATION="$(curl -fsS "${AUTH_HEADER[@]}" -X POST "${API_BASE_URL}/control/credits/reserve" -d "$(jq -n --arg account_id "${ACCOUNT_ID}" --arg key "${RESERVE_KEY}" '{account_id:$account_id, amount:1, ref_type:"smoke", ref_id:"smoke-consume", idempotency_key:$key}')")"
RESERVATION_ID="$(printf '%s' "${RESERVATION}" | jq -r '.id')"

if [[ -z "${RESERVATION_ID}" || "${RESERVATION_ID}" == "null" ]]; then
  echo "ERROR: unable to reserve credits" >&2
  exit 1
fi

CONSUME_KEY="smoke-consume-${SUFFIX}"
curl -fsS "${AUTH_HEADER[@]}" -X POST "${API_BASE_URL}/control/credits/consume" -d "$(jq -n --arg account_id "${ACCOUNT_ID}" --arg reservation_id "${RESERVATION_ID}" --arg key "${CONSUME_KEY}" '{account_id:$account_id, reservation_id:$reservation_id, idempotency_key:$key}')" >/dev/null

echo "[smoke-v2] reserve + release credits"
RESERVE_RELEASE_KEY="smoke-reserve-release-${SUFFIX}"
RESERVE_RELEASE="$(curl -fsS "${AUTH_HEADER[@]}" -X POST "${API_BASE_URL}/control/credits/reserve" -d "$(jq -n --arg account_id "${ACCOUNT_ID}" --arg key "${RESERVE_RELEASE_KEY}" '{account_id:$account_id, amount:1, ref_type:"smoke", ref_id:"smoke-release", idempotency_key:$key}')")"
RESERVE_RELEASE_ID="$(printf '%s' "${RESERVE_RELEASE}" | jq -r '.id')"
if [[ -z "${RESERVE_RELEASE_ID}" || "${RESERVE_RELEASE_ID}" == "null" ]]; then
  echo "ERROR: unable to reserve credits for release flow" >&2
  exit 1
fi

RELEASE_KEY="smoke-release-${SUFFIX}"
curl -fsS "${AUTH_HEADER[@]}" -X POST "${API_BASE_URL}/control/credits/release" -d "$(jq -n --arg account_id "${ACCOUNT_ID}" --arg reservation_id "${RESERVE_RELEASE_ID}" --arg key "${RELEASE_KEY}" '{account_id:$account_id, reservation_id:$reservation_id, idempotency_key:$key}')" >/dev/null

echo "[smoke-v2] switch account to POSTPAID and run invoice flow"
curl -fsS "${AUTH_HEADER[@]}" -X PATCH "${API_BASE_URL}/control/accounts/${ACCOUNT_ID}/policy" -d '{"billing_mode":"postpaid","payment_terms_days":15,"currency":"INR","is_enabled":true}' >/dev/null
INVOICE_CREATE="$(curl -fsS "${AUTH_HEADER[@]}" -X POST "${API_BASE_URL}/service-invoices" -d "$(jq -n --arg account_id "${ACCOUNT_ID}" '{account_id:$account_id, notes:"smoke invoice", items:[{description:"Smoke service",quantity:1,unit_price:199.00,order_index:0}] }')")"
INVOICE_ID="$(printf '%s' "${INVOICE_CREATE}" | jq -r '.id')"
if [[ -z "${INVOICE_ID}" || "${INVOICE_ID}" == "null" ]]; then
  echo "ERROR: unable to create service invoice" >&2
  exit 1
fi

curl -fsS "${AUTH_HEADER[@]}" -H "Idempotency-Key: smoke-issue-${SUFFIX}" -X POST "${API_BASE_URL}/service-invoices/${INVOICE_ID}/issue" -d '{}' >/dev/null
curl -fsS "${AUTH_HEADER[@]}" -H "Idempotency-Key: smoke-mark-paid-${SUFFIX}" -X POST "${API_BASE_URL}/service-invoices/${INVOICE_ID}/mark-paid" -d '{"mode":"manual","notes":"smoke mark paid"}' >/dev/null
curl -fsS "${AUTH_HEADER[@]}" -H "Idempotency-Key: smoke-mark-paid-${SUFFIX}" -X POST "${API_BASE_URL}/service-invoices/${INVOICE_ID}/mark-paid" -d '{"mode":"manual","notes":"smoke mark paid"}' >/dev/null

echo "[smoke-v2] reconcile dry-run"
curl -fsS "${AUTH_HEADER[@]}" -X POST "${API_BASE_URL}/control/credits/reconcile" -d "$(jq -n --arg tenant_id "${TENANT_ID}" '{tenant_id:$tenant_id, dry_run:true, limit:50}')" >/dev/null

echo "[smoke-v2] success"
