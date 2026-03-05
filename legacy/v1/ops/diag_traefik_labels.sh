#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="${COMPOSE_PROJECT_NAME:-zenops}"

log() {
  printf '[diag-traefik-labels] %s\n' "$*"
}

print_container_block() {
  local container="$1"
  log "Container: ${container}"
  docker inspect "${container}" --format '  image={{.Config.Image}}' || true

  local enable
  enable="$(docker inspect "${container}" --format '{{ index .Config.Labels "traefik.enable" }}' 2>/dev/null || true)"
  printf '  traefik.enable=%s\n' "${enable:-<unset>}"

  local all_labels
  all_labels="$(docker inspect "${container}" --format '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}{{println}}{{end}}' 2>/dev/null || true)"

  echo "  routers:"
  printf '%s\n' "${all_labels}" | grep '^traefik.http.routers.' || true

  echo "  services:"
  printf '%s\n' "${all_labels}" | grep '^traefik.http.services.' || true

  echo "  attached networks:"
  docker inspect "${container}" --format '{{range $k,$v := .NetworkSettings.Networks}}    {{$k}} (ip={{$v.IPAddress}}){{println}}{{end}}' || true

  echo
}

log "Collecting containers in project prefix '${PROJECT_NAME}-' plus Traefik containers"
containers="$(docker ps -a --format '{{.Names}}' | awk -v prefix="^"'"${PROJECT_NAME}"'"-" '($0 ~ prefix) || (tolower($0) ~ /traefik/)')"

if [[ -z "${containers}" ]]; then
  log "No matching containers found."
  exit 0
fi

while IFS= read -r name; do
  [[ -n "${name}" ]] || continue
  print_container_block "${name}"
done <<< "${containers}"
