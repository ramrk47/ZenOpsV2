#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

ENV_FILE="${ROOT_DIR}/.env.demo"
[[ -f "${ENV_FILE}" ]] || { echo "[demo-smoke][FAIL] Missing .env.demo. Run ./ops/bootstrap_demo_env.sh first."; exit 1; }

# shellcheck disable=SC1090
source "${ENV_FILE}"

DOMAIN="${APP_DOMAIN:-demo.maulya.in}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-maulya-demo}"
VPS_PUBLIC_IP_VALUE="${VPS_PUBLIC_IP:-}"

log() {
  printf '[demo-smoke] %s\n' "$*"
}

fail() {
  printf '[demo-smoke][FAIL] %s\n' "$*" >&2
  exit 1
}

detect_vps_ip() {
  local detected=""
  if [[ -n "${VPS_PUBLIC_IP_VALUE}" ]]; then
    detected="${VPS_PUBLIC_IP_VALUE}"
  else
    detected="$(curl -4 -sS --max-time 4 https://api.ipify.org || true)"
  fi
  if [[ ! "${detected}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && command -v ip >/dev/null 2>&1; then
    detected="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')"
  fi
  if [[ ! "${detected}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && command -v hostname >/dev/null 2>&1; then
    detected="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  if [[ "${detected}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    VPS_PUBLIC_IP_VALUE="${detected}"
  else
    VPS_PUBLIC_IP_VALUE=""
  fi
}

http_code() {
  curl -sS -o /tmp/demo-smoke.out -w '%{http_code}' --max-time 10 "$@" || echo "000"
}

expect_code() {
  local name="$1"
  local expected="$2"
  shift 2
  local code
  code="$(http_code "$@")"
  if [[ "${code}" != "${expected}" ]]; then
    cat /tmp/demo-smoke.out >&2 || true
    fail "${name} expected HTTP ${expected}, got ${code}"
  fi
  log "PASS ${name}: HTTP ${code}"
}

expect_one_of() {
  local name="$1"
  local allowed="$2"
  shift 2
  local code
  code="$(http_code "$@")"
  case ",${allowed}," in
    *",${code},"*) log "PASS ${name}: HTTP ${code}" ;;
    *)
      cat /tmp/demo-smoke.out >&2 || true
      fail "${name} expected one of [${allowed}], got ${code}"
      ;;
  esac
}

expect_front_door() {
  local name="$1"
  local allowed="$2"
  local scheme="$3"
  shift 3
  local code
  code="$(http_code -I "$@" "${scheme}://${DOMAIN}/")"
  case ",${allowed}," in
    *",${code},"*)
      log "PASS ${name}: HTTP ${code}"
      return 0
      ;;
  esac

  if [[ "${scheme}" == "http" ]]; then
    code="$(http_code -I -H "Host: ${DOMAIN}" "http://127.0.0.1/")"
  else
    code="$(http_code -I -k -H "Host: ${DOMAIN}" "https://127.0.0.1/")"
  fi

  case ",${allowed}," in
    *",${code},"*)
      log "PASS ${name} via local host-header fallback: HTTP ${code}"
      ;;
    *)
      cat /tmp/demo-smoke.out >&2 || true
      fail "${name} expected one of [${allowed}], got ${code}"
      ;;
  esac
}

login_token() {
  local email="$1"
  local password="$2"
  local payload
  payload="$(curl -sS --max-time 10 -H "Host: ${DOMAIN}" -H "Content-Type: application/x-www-form-urlencoded" \
    --data "username=${email}&password=${password}" \
    http://127.0.0.1/api/auth/login || true)"
  printf '%s' "${payload}" | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

detect_vps_ip

HTTP_RESOLVE_ARGS=()
HTTPS_RESOLVE_ARGS=()
if [[ -n "${VPS_PUBLIC_IP_VALUE}" ]]; then
  HTTP_RESOLVE_ARGS=(--resolve "${DOMAIN}:80:${VPS_PUBLIC_IP_VALUE}")
  HTTPS_RESOLVE_ARGS=(--resolve "${DOMAIN}:443:${VPS_PUBLIC_IP_VALUE}")
fi

log "Domain=${DOMAIN} project=${PROJECT_NAME}"
if [[ -n "${VPS_PUBLIC_IP_VALUE}" ]]; then
  log "Using direct resolve IP ${VPS_PUBLIC_IP_VALUE}"
fi

expect_front_door "HTTP front-door" "200,301,302,307,308" "http" "${HTTP_RESOLVE_ARGS[@]}"
expect_front_door "HTTPS front-door" "200,301,302,307,308" "https" -k "${HTTPS_RESOLVE_ARGS[@]}"

expect_code "healthz via host header" "200" -H "Host: ${DOMAIN}" "http://127.0.0.1/healthz"
expect_code "readyz via host header" "200" -H "Host: ${DOMAIN}" "http://127.0.0.1/readyz"
expect_code "version via host header" "200" -H "Host: ${DOMAIN}" "http://127.0.0.1/version"

admin_token="$(login_token "admin@maulya.local" "password")"
field_token="$(login_token "field@maulya.local" "password")"
associate_token="$(login_token "associate@maulya.local" "password")"

[[ -n "${admin_token}" ]] || fail "Admin demo login failed"
[[ -n "${field_token}" ]] || fail "Field demo login failed"
[[ -n "${associate_token}" ]] || fail "Associate demo login failed"

expect_code "field assignments list" "200" -H "Host: ${DOMAIN}" -H "Authorization: Bearer ${field_token}" "http://127.0.0.1/api/assignments/with-due?completion=ALL"
expect_code "admin approvals inbox" "200" -H "Host: ${DOMAIN}" -H "Authorization: Bearer ${admin_token}" "http://127.0.0.1/api/approvals/inbox"
expect_code "associate auth me" "200" -H "Host: ${DOMAIN}" -H "Authorization: Bearer ${associate_token}" "http://127.0.0.1/api/auth/me"

draft_payload="$(cat <<JSON
{"case_type":"BANK","service_line":"VALUATION","bank_id":1,"branch_id":1,"property_type_id":1,"borrower_name":"Demo Smoke $(date +%s)","phone":"9000000000","address":"Demo Smoke Street","uom":"sqft","land_area":1200,"builtup_area":850,"notes":"Created by demo smoke"}
JSON
)"

expect_code "field create draft" "201" \
  -H "Host: ${DOMAIN}" \
  -H "Authorization: Bearer ${field_token}" \
  -H "Content-Type: application/json" \
  --data "${draft_payload}" \
  "http://127.0.0.1/api/assignments/drafts"

log "Demo smoke checks passed"
