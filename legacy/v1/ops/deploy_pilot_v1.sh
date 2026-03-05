#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

PROJECT_NAME="${COMPOSE_PROJECT_NAME:-zenops}"
COMPOSE_FILES=(-f docker-compose.hostinger.yml -f docker-compose.pilot.yml)
DOMAIN="${ZENOPS_DOMAIN:-zenops.notalonestudios.com}"

log() {
  printf '[deploy-pilot-v1] %s\n' "$*"
}

fail_with_logs() {
  local reason="$1"
  printf '[deploy-pilot-v1][FAIL] %s\n' "${reason}" >&2
  docker ps || true
  local traefik_container
  local traefik_log="/tmp/deploy-pilot-v1.traefik.log"
  traefik_container="$(docker ps --format '{{.Names}} {{.Image}}' | awk 'tolower($0) ~ /traefik/ { print $1; exit }')"
  if [[ -n "${traefik_container}" ]]; then
    docker logs --tail 200 "${traefik_container}" >"${traefik_log}" 2>&1 || true
    cat "${traefik_log}" || true
    if grep -q "client version 1.24 is too old" "${traefik_log}"; then
      printf '[deploy-pilot-v1][HINT] Traefik Docker provider API mismatch detected. Use deploy/traefik image traefik:v3.6+ and recreate the Traefik stack.\n' >&2
    fi
  else
    printf '[deploy-pilot-v1] No running Traefik container found for log dump.\n' >&2
  fi
  docker compose -p "${PROJECT_NAME}" "${COMPOSE_FILES[@]}" logs --tail=80 api || true
  exit 1
}

require_file() {
  local path="$1"
  [[ -f "${path}" ]] || fail_with_logs "Missing required file: ${path}"
}

require_backend_env_nonempty() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" .env.backend | tail -n1 | cut -d= -f2- || true)"
  if [[ -z "${value}" ]]; then
    fail_with_logs "Missing required ${key} in .env.backend"
  fi
}

http_status() {
  local url="$1"
  shift
  curl -sS -o /tmp/deploy-pilot-v1.out -w '%{http_code}' --max-time 8 "$@" "${url}" || echo "000"
}

check_http_header_route() {
  local code
  code="$(http_status "http://127.0.0.1/" -I -H "Host: ${DOMAIN}")"
  case "${code}" in
    200|301|302|307|308|404) log "PASS host-header route check (/): HTTP ${code}" ;;
    *) fail_with_logs "Host-header route check failed for / (HTTP ${code})" ;;
  esac
}

check_health_route() {
  local path="$1"
  local code
  code="$(http_status "http://127.0.0.1${path}" -H "Host: ${DOMAIN}")"
  if [[ "${code}" != "200" ]]; then
    cat /tmp/deploy-pilot-v1.out >&2 || true
    fail_with_logs "Health route ${path} failed over Traefik host-header (HTTP ${code})"
  fi
  log "PASS ${path} over Traefik host-header: HTTP ${code}"
}

check_traefik_router_api() {
  local routers_file="/tmp/deploy-pilot-v1.routers.json"
  local code
  code="$(curl -sS -o "${routers_file}" -w '%{http_code}' --max-time 5 http://127.0.0.1:8088/api/http/routers || echo "000")"
  if [[ "${code}" != "200" ]]; then
    fail_with_logs "Traefik API router endpoint failed (HTTP ${code})"
  fi
  if ! grep -qE '^\s*\[' "${routers_file}"; then
    sed -n '1,80p' "${routers_file}" || true
    fail_with_logs "Traefik API router response is not valid JSON"
  fi
  if ! grep -q "zenops-web" "${routers_file}" || ! grep -q "zenops-api" "${routers_file}"; then
    sed -n '1,120p' "${routers_file}" || true
    fail_with_logs "Traefik routers missing zenops-web or zenops-api"
  fi
  log "PASS Traefik router API JSON has zenops-web + zenops-api"
}

check_resolve_probe() {
  local ip="$1"
  local code
  code="$(curl -sS -o /tmp/deploy-pilot-v1.resolve.out -w '%{http_code}' --max-time 8 --resolve "${DOMAIN}:80:${ip}" "http://${DOMAIN}/healthz" || echo "000")"
  if [[ "${code}" != "200" ]]; then
    cat /tmp/deploy-pilot-v1.resolve.out >&2 || true
    fail_with_logs "Resolve probe failed for http://${DOMAIN}/healthz via ${ip} (HTTP ${code})"
  fi
  log "PASS --resolve probe for ${DOMAIN} via ${ip}: HTTP ${code}"
}

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "Pulling latest code (git pull --ff-only)"
  git pull --ff-only || fail_with_logs "git pull failed"
fi

require_file ".env"
require_file ".env.backend"
require_backend_env_nonempty "JWT_SECRET"
require_backend_env_nonempty "DATABASE_URL"

if [[ -z "${ZENOPS_DOMAIN:-}" ]]; then
  # shellcheck disable=SC1091
  source .env
  DOMAIN="${ZENOPS_DOMAIN:-${DOMAIN}}"
fi

ASSOCIATE_EMAIL_MODE_VALUE="$(grep -E '^ASSOCIATE_EMAIL_MODE=' .env.backend | tail -n1 | cut -d= -f2- || true)"
ASSOCIATE_EMAIL_MODE_VALUE="${ASSOCIATE_EMAIL_MODE_VALUE:-email}"
ASSOCIATE_EMAIL_MODE_VALUE="$(printf '%s' "${ASSOCIATE_EMAIL_MODE_VALUE}" | tr '[:upper:]' '[:lower:]')"

log "Ensuring Traefik external network exists"
docker network create traefik-proxy >/dev/null 2>&1 || true

log "Rendering compose config sanity"
docker compose -p "${PROJECT_NAME}" "${COMPOSE_FILES[@]}" config >/dev/null || fail_with_logs "docker compose config failed"

log "Starting DB + uploads perms"
docker compose -p "${PROJECT_NAME}" "${COMPOSE_FILES[@]}" up -d db uploads-perms || fail_with_logs "Failed starting db/uploads-perms"

log "Running migrations"
docker compose -p "${PROJECT_NAME}" "${COMPOSE_FILES[@]}" run --rm migrate || fail_with_logs "Migration failed"

if [[ "${ASSOCIATE_EMAIL_MODE_VALUE}" == "disabled" ]]; then
  log "ASSOCIATE_EMAIL_MODE=disabled -> skipping email-worker in pilot fallback mode"
  docker compose -p "${PROJECT_NAME}" "${COMPOSE_FILES[@]}" up -d api frontend || fail_with_logs "Failed starting api/frontend"
else
  log "Starting API + email-worker + frontend"
  docker compose -p "${PROJECT_NAME}" "${COMPOSE_FILES[@]}" up -d api email-worker frontend || fail_with_logs "Failed starting app services"
fi

log "Running Traefik route checks for ${DOMAIN}"
check_traefik_router_api
check_http_header_route
check_health_route "/healthz"
check_health_route "/readyz"
check_health_route "/version"

VPS_PUBLIC_IP_VALUE="${VPS_PUBLIC_IP:-}"
if [[ -z "${VPS_PUBLIC_IP_VALUE}" ]]; then
  VPS_PUBLIC_IP_VALUE="$(curl -sS --max-time 4 https://api.ipify.org || true)"
fi
if [[ "${VPS_PUBLIC_IP_VALUE}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  check_resolve_probe "${VPS_PUBLIC_IP_VALUE}"
else
  log "Skipping --resolve probe because VPS public IP is unavailable (set VPS_PUBLIC_IP to enforce)."
fi

log "Pilot deploy checks passed"
