#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

ENV_FILE="${ROOT_DIR}/.env.demo"
BACKEND_ENV_FILE="${ROOT_DIR}/.env.demo.backend"
COMPOSE_FILES=(-f docker-compose.hostinger.yml -f docker-compose.demo.yml)

[[ -f "${ENV_FILE}" ]] || { echo "[demo-up][FAIL] Missing .env.demo. Run ./ops/bootstrap_demo_env.sh first."; exit 1; }
[[ -f "${BACKEND_ENV_FILE}" ]] || { echo "[demo-up][FAIL] Missing .env.demo.backend. Run ./ops/bootstrap_demo_env.sh first."; exit 1; }

# shellcheck disable=SC1090
source "${ENV_FILE}"

PROJECT_NAME="${COMPOSE_PROJECT_NAME:-maulya-demo}"
DOMAIN="${APP_DOMAIN:-demo.maulya.in}"

log() {
  printf '[demo-up] %s\n' "$*"
}

container_name() {
  printf '%s-%s-1' "${PROJECT_NAME//_/-}" "$1"
}

wait_for_container() {
  local service="$1"
  local timeout="${2:-120}"
  local name
  local status
  local deadline=$((SECONDS + timeout))
  name="$(container_name "${service}")"

  while (( SECONDS < deadline )); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${name}" 2>/dev/null || true)"
    case "${status}" in
      healthy|running)
        log "PASS ${name} is ${status}"
        return 0
        ;;
    esac
    sleep 2
  done

  docker compose --env-file "${ENV_FILE}" -p "${PROJECT_NAME}" "${COMPOSE_FILES[@]}" logs --tail=120 api frontend || true
  echo "[demo-up][FAIL] Timed out waiting for ${name}" >&2
  exit 1
}

http_code() {
  curl -sS -o /tmp/demo-up.out -w '%{http_code}' --max-time 8 "$@" || echo "000"
}

log "Ensuring Traefik external network exists"
docker network create traefik-proxy >/dev/null 2>&1 || true

log "Rendering compose config"
docker compose --env-file "${ENV_FILE}" -p "${PROJECT_NAME}" "${COMPOSE_FILES[@]}" config >/dev/null

log "Building API + frontend"
docker compose --env-file "${ENV_FILE}" -p "${PROJECT_NAME}" "${COMPOSE_FILES[@]}" build api frontend

log "Starting DB + Redis + uploads perms"
docker compose --env-file "${ENV_FILE}" -p "${PROJECT_NAME}" "${COMPOSE_FILES[@]}" up -d db redis uploads-perms

log "Running migrations"
docker compose --env-file "${ENV_FILE}" -p "${PROJECT_NAME}" "${COMPOSE_FILES[@]}" run --rm migrate

log "Starting demo app services"
docker compose --env-file "${ENV_FILE}" -p "${PROJECT_NAME}" "${COMPOSE_FILES[@]}" up -d api email-worker frontend

wait_for_container "api" 120
wait_for_container "frontend" 120

code="$(http_code -I -H "Host: ${DOMAIN}" http://127.0.0.1/)"
case "${code}" in
  200|301|302|307|308) log "PASS host-header route (/): HTTP ${code}" ;;
  *) cat /tmp/demo-up.out >&2 || true; echo "[demo-up][FAIL] host-header route check failed (HTTP ${code})" >&2; exit 1 ;;
esac

for path in /healthz /readyz /version; do
  code="$(http_code -H "Host: ${DOMAIN}" "http://127.0.0.1${path}")"
  if [[ "${code}" != "200" ]]; then
    cat /tmp/demo-up.out >&2 || true
    echo "[demo-up][FAIL] ${path} failed (HTTP ${code})" >&2
    exit 1
  fi
  log "PASS ${path}: HTTP ${code}"
done

log "Demo stack is up"
