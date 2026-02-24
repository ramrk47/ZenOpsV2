#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ENV_BACKEND_CREATED=0
TMP_ENV_FRONTEND_CREATED=0

cleanup() {
  if [[ "${TMP_ENV_BACKEND_CREATED}" -eq 1 ]]; then
    rm -f "${ROOT}/.env.backend"
  fi
  if [[ "${TMP_ENV_FRONTEND_CREATED}" -eq 1 ]]; then
    rm -f "${ROOT}/.env.frontend"
  fi
}
trap cleanup EXIT

if [[ ! -f "${ROOT}/.env.backend" && -f "${ROOT}/.env.backend.example" ]]; then
  cp "${ROOT}/.env.backend.example" "${ROOT}/.env.backend"
  TMP_ENV_BACKEND_CREATED=1
fi

if [[ ! -f "${ROOT}/.env.frontend" && -f "${ROOT}/.env.frontend.example" ]]; then
  cp "${ROOT}/.env.frontend.example" "${ROOT}/.env.frontend"
  TMP_ENV_FRONTEND_CREATED=1
fi

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
