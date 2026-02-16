#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/.env.prod"
if [[ ! -f "${ENV_FILE}" ]]; then
  ENV_FILE="${ROOT}/.env.prod.example"
fi
TMP_ENV_CREATED=0
TMP_ENV_PROD_CREATED=0

cleanup() {
  if [[ "${TMP_ENV_CREATED}" -eq 1 ]]; then
    rm -f "${ROOT}/.env"
  fi
  if [[ "${TMP_ENV_PROD_CREATED}" -eq 1 ]]; then
    rm -f "${ROOT}/.env.prod"
  fi
}
trap cleanup EXIT

if [[ ! -f "${ROOT}/.env" ]]; then
  cp "${ROOT}/.env.example" "${ROOT}/.env"
  TMP_ENV_CREATED=1
fi

if [[ ! -f "${ROOT}/.env.prod" ]]; then
  cp "${ROOT}/.env.prod.example" "${ROOT}/.env.prod"
  TMP_ENV_PROD_CREATED=1
fi

echo "[docker-test] validating V2 compose files"

echo "[docker-test] docker compose -f infra/docker/compose.infra.yml config -q"
docker compose -f "${ROOT}/infra/docker/compose.infra.yml" config -q

echo "[docker-test] docker compose -f infra/docker/compose.dev.yml config -q"
docker compose -f "${ROOT}/infra/docker/compose.dev.yml" config -q

echo "[docker-test] docker compose --env-file ${ENV_FILE##${ROOT}/} -f infra/docker/compose.prod.yml config -q"
docker compose --env-file "${ENV_FILE}" -f "${ROOT}/infra/docker/compose.prod.yml" config -q

echo "[docker-test] docker compose --env-file ${ENV_FILE##${ROOT}/} -f infra/docker/compose.vps.yml config -q"
docker compose --env-file "${ENV_FILE}" -f "${ROOT}/infra/docker/compose.vps.yml" config -q

echo "[docker-test] all V2 compose files validated"
