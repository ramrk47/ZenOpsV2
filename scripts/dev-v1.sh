#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
V1_ROOT="${ROOT}/legacy/v1"
TMP_ENV_BACKEND_CREATED=0
TMP_ENV_FRONTEND_CREATED=0

if [[ ! -d "${V1_ROOT}" ]]; then
  echo "ERROR: legacy/v1 not found. Import V1 subtree first." >&2
  exit 1
fi

cleanup() {
  if [[ "${TMP_ENV_BACKEND_CREATED}" -eq 1 ]]; then
    rm -f "${V1_ROOT}/.env.backend"
  fi
  if [[ "${TMP_ENV_FRONTEND_CREATED}" -eq 1 ]]; then
    rm -f "${V1_ROOT}/.env.frontend"
  fi
}
trap cleanup EXIT

if [[ ! -f "${V1_ROOT}/.env.backend" && -f "${V1_ROOT}/.env.backend.example" ]]; then
  cp "${V1_ROOT}/.env.backend.example" "${V1_ROOT}/.env.backend"
  TMP_ENV_BACKEND_CREATED=1
fi

if [[ ! -f "${V1_ROOT}/.env.frontend" && -f "${V1_ROOT}/.env.frontend.example" ]]; then
  cp "${V1_ROOT}/.env.frontend.example" "${V1_ROOT}/.env.frontend"
  TMP_ENV_FRONTEND_CREATED=1
fi

cd "${V1_ROOT}"

if [[ "$#" -eq 0 ]]; then
  exec docker compose -f docker-compose.yml up -d --build
fi

exec docker compose -f docker-compose.yml "$@"
