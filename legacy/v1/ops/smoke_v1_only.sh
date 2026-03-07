#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  source .env
fi

DOMAIN="${APP_DOMAIN:-app.maulya.in}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-maulya}"
ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL:-admin@maulya.local}"
ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD:-password}"
VPS_PUBLIC_IP_VALUE="${VPS_PUBLIC_IP:-}"

log() {
  printf '[smoke-v1-only] %s\n' "$*"
}

fail() {
  printf '[smoke-v1-only][FAIL] %s\n' "$*" >&2
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

resolve_args_for_port() {
  local port="$1"
  if [[ -n "${VPS_PUBLIC_IP_VALUE}" ]]; then
    printf -- '--resolve %s:%s:%s' "${DOMAIN}" "${port}" "${VPS_PUBLIC_IP_VALUE}"
  fi
}

expect_code() {
  local name="$1"
  local url="$2"
  local expected="$3"
  shift 3
  local code
  code="$(curl -sS -o /tmp/smoke-v1-only.out -w '%{http_code}' --max-time 8 "$@" "${url}" || echo "000")"
  if [[ "${code}" != "${expected}" ]]; then
    cat /tmp/smoke-v1-only.out >&2 || true
    fail "${name} expected HTTP ${expected}, got ${code}"
  fi
  log "PASS ${name}: HTTP ${code}"
}

expect_one_of_codes() {
  local name="$1"
  local url="$2"
  local allowed="$3"
  shift 3
  local code
  code="$(curl -sS -o /tmp/smoke-v1-only.out -w '%{http_code}' --max-time 8 "$@" "${url}" || echo "000")"
  case ",${allowed}," in
    *",${code},"*) log "PASS ${name}: HTTP ${code}" ;;
    *)
      cat /tmp/smoke-v1-only.out >&2 || true
      fail "${name} expected one of [${allowed}], got ${code}"
      ;;
  esac
}

expect_front_door_code() {
  local name="$1"
  local scheme="$2"
  local allowed="$3"
  shift 3
  local code
  code="$(curl -sS -o /tmp/smoke-v1-only.out -w '%{http_code}' --max-time 8 "$@" "${scheme}://${DOMAIN}/" || echo "000")"
  case ",${allowed}," in
    *",${code},"*)
      log "PASS ${name}: HTTP ${code}"
      return 0
      ;;
  esac

  if [[ "${scheme}" == "http" ]]; then
    code="$(curl -sS -o /tmp/smoke-v1-only.out -w '%{http_code}' --max-time 8 -I -H "Host: ${DOMAIN}" "http://127.0.0.1/" || echo "000")"
  else
    code="$(curl -sS -o /tmp/smoke-v1-only.out -w '%{http_code}' --max-time 8 -I -k -H "Host: ${DOMAIN}" "https://127.0.0.1/" || echo "000")"
  fi

  case ",${allowed}," in
    *",${code},"*)
      log "PASS ${name} via local host-header fallback: HTTP ${code}"
      ;;
    *)
      cat /tmp/smoke-v1-only.out >&2 || true
      fail "${name} expected one of [${allowed}], got ${code}"
      ;;
  esac
}

log "Domain=${DOMAIN} project=${PROJECT_NAME}"

detect_vps_ip

HTTP_RESOLVE_ARGS="$(resolve_args_for_port 80)"
HTTPS_RESOLVE_ARGS="$(resolve_args_for_port 443)"
if [[ -n "${VPS_PUBLIC_IP_VALUE}" ]]; then
  log "Using direct resolve IP ${VPS_PUBLIC_IP_VALUE}"
fi

# shellcheck disable=SC2086
expect_front_door_code "HTTP front-door" "http" "200,301,302,307,308" -I ${HTTP_RESOLVE_ARGS}
# shellcheck disable=SC2086
expect_front_door_code "HTTPS front-door" "https" "200,301,302,307,308" -I -k ${HTTPS_RESOLVE_ARGS}

expect_code "healthz via host header" "http://127.0.0.1/healthz" "200" -H "Host: ${DOMAIN}"
expect_code "readyz via host header" "http://127.0.0.1/readyz" "200" -H "Host: ${DOMAIN}"
expect_code "version via host header" "http://127.0.0.1/version" "200" -H "Host: ${DOMAIN}"

expect_one_of_codes "auth me without token" "http://127.0.0.1/api/auth/me" "401" -H "Host: ${DOMAIN}"
expect_one_of_codes "login endpoint reachable (wrong creds)" "http://127.0.0.1/api/auth/login" "400,401,429" \
  -H "Host: ${DOMAIN}" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "username=invalid@invalid.local&password=invalid"

log "Requesting admin token for analytics probe"
login_payload="$(curl -sS --max-time 8 -H "Host: ${DOMAIN}" -H "Content-Type: application/x-www-form-urlencoded" \
  --data "username=${ADMIN_EMAIL}&password=${ADMIN_PASSWORD}" \
  http://127.0.0.1/api/auth/login || true)"
token="$(printf '%s' "${login_payload}" | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
[[ -n "${token}" ]] || fail "Admin login failed for analytics probe (set SMOKE_ADMIN_EMAIL/SMOKE_ADMIN_PASSWORD)"

expect_code "analytics API (admin token)" "http://127.0.0.1/api/analytics/source-intel" "200" \
  -H "Host: ${DOMAIN}" \
  -H "Authorization: Bearer ${token}"

log "Checking API logs for 500s"
api_logs="$(docker logs --tail 200 "${PROJECT_NAME}-api-1" 2>&1 || true)"
if printf '%s\n' "${api_logs}" | grep -Eq 'status_code": 500|HTTP/1\.[01]" 500| 500 '; then
  printf '%s\n' "${api_logs}" | tail -n 200 >&2
  fail "Detected 500s in last 200 API log lines"
fi
log "PASS no 500s in last 200 API log lines"

log "All V1-only pilot smoke checks passed"
