#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="${COMPOSE_PROJECT_NAME:-zenops}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

api_container="${PROJECT_NAME}-api-1"
frontend_container="${PROJECT_NAME}-frontend-1"
traefik_container="${TRAEFIK_CONTAINER_NAME:-}"

if [[ -z "${traefik_container}" ]]; then
  traefik_container="$(docker ps --format '{{.Names}} {{.Image}}' | awk 'tolower($0) ~ /traefik/ { print $1; exit }')"
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

log() {
  printf '\n[diag-traefik-v1] %s\n' "$*"
}

show_probe_result() {
  local name="$1"
  local header_file="$2"
  local body_file="$3"
  local status_line content_type body_len
  status_line="$(head -n 1 "${header_file}" 2>/dev/null || true)"
  content_type="$(grep -i '^content-type:' "${header_file}" | tail -n 1 | sed 's/\r$//' || true)"
  body_len="$(wc -c < "${body_file}" 2>/dev/null || echo 0)"
  printf '[diag-traefik-v1] %s status: %s\n' "${name}" "${status_line:-<none>}"
  printf '[diag-traefik-v1] %s content-type: %s\n' "${name}" "${content_type:-<none>}"
  printf '[diag-traefik-v1] %s response-bytes: %s\n' "${name}" "${body_len}"
}

http_probe() {
  local name="$1"
  local url="$2"
  shift 2
  local header_file="${tmp_dir}/${name}.headers"
  local body_file="${tmp_dir}/${name}.body"
  log "Probe ${name}: ${url}"
  curl -sS -D "${header_file}" -o "${body_file}" --max-time 5 "$@" "${url}" || true
  show_probe_result "${name}" "${header_file}" "${body_file}"
  sed -n '1,40p' "${body_file}" || true
}

print_container_networks() {
  local container="$1"
  if ! docker ps -a --format '{{.Names}}' | grep -Fxq "${container}"; then
    printf '[diag-traefik-v1] %s missing\n' "${container}"
    return
  fi
  printf '[diag-traefik-v1] %s networks:\n' "${container}"
  docker inspect "${container}" --format '{{json .NetworkSettings.Networks}}' || true
}

log "Container + port status"
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
ss -ltnp | grep -E ':80 |:443 |:8088 ' || true

log "Traefik API sanity probes (verbatim)"
curl -v --max-time 3 http://127.0.0.1:8088/api/overview || true
curl -v --max-time 3 http://127.0.0.1:8088/api/http/routers || true
curl -v --max-time 3 http://127.0.0.1:8088/dashboard/ || true

http_probe "traefik_overview" "http://127.0.0.1:8088/api/overview"
http_probe "traefik_routers" "http://127.0.0.1:8088/api/http/routers"
http_probe "traefik_dashboard" "http://127.0.0.1:8088/dashboard/"

log "Entrypoint probes (verbatim)"
curl -v --max-time 5 -H "Host: zenops.notalonestudios.com" http://127.0.0.1/ || true
curl -vk --max-time 5 https://127.0.0.1/ -H "Host: zenops.notalonestudios.com" || true

http_probe "entry_http" "http://127.0.0.1/" -H "Host: zenops.notalonestudios.com"
http_probe "entry_https" "https://127.0.0.1/" -k -H "Host: zenops.notalonestudios.com"

log "Bypass Traefik: API direct checks"
if docker ps -a --format '{{.Names}}' | grep -Fxq "${api_container}"; then
  docker exec "${api_container}" sh -lc 'wget -qO- http://127.0.0.1:8000/healthz || true' || true
  api_ip="$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${api_container}")"
  printf '[diag-traefik-v1] %s IP(s): %s\n' "${api_container}" "${api_ip:-<none>}"
  if [[ -n "${api_ip}" ]]; then
    curl -sS --max-time 5 "http://${api_ip}:8000/healthz" || true
    printf '\n'
  fi
else
  printf '[diag-traefik-v1] API container not found: %s\n' "${api_container}"
fi

log "Traefik command/flags"
if [[ -n "${traefik_container}" ]]; then
  docker inspect "${traefik_container}" --format '{{json .Config.Cmd}}' || true
else
  printf '[diag-traefik-v1] No running Traefik container found.\n'
fi

log "Labels and network membership"
if docker ps -a --format '{{.Names}}' | grep -Fxq "${frontend_container}"; then
  docker inspect "${frontend_container}" --format '{{json .Config.Labels}}' || true
fi
if docker ps -a --format '{{.Names}}' | grep -Fxq "${api_container}"; then
  docker inspect "${api_container}" --format '{{json .Config.Labels}}' || true
fi
print_container_networks "${frontend_container}"
print_container_networks "${api_container}"
if [[ -n "${traefik_container}" ]]; then
  print_container_networks "${traefik_container}"
fi

log "Last 150 lines: Traefik logs"
if [[ -n "${traefik_container}" ]]; then
  docker logs --tail 150 "${traefik_container}" || true
else
  printf '[diag-traefik-v1] No running Traefik container found.\n'
fi

log "Last 150 lines: API logs"
if docker ps -a --format '{{.Names}}' | grep -Fxq "${api_container}"; then
  docker logs --tail 150 "${api_container}" || true
else
  printf '[diag-traefik-v1] API container not found: %s\n' "${api_container}"
fi
