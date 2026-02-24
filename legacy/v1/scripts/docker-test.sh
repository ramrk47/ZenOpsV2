#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[docker-test] validating V1 compose files"

compose_files=(
  "docker-compose.yml"
  "docker-compose.dev.yml"
  "docker-compose.hostinger.yml"
)

for compose_file in "${compose_files[@]}"; do
  if [[ ! -f "${ROOT}/${compose_file}" ]]; then
    echo "ERROR: missing compose file: ${compose_file}" >&2
    exit 1
  fi
  echo "[docker-test] docker compose -f ${compose_file} config -q"
  docker compose -f "${ROOT}/${compose_file}" config -q
done

echo "[docker-test] all V1 compose files validated"
