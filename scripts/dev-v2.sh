#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

: "${COMPOSE_PROJECT_NAME:=zenopsv2-bridge}"
: "${POSTGRES_BIND_PORT:=65432}"
: "${REDIS_BIND_PORT:=56380}"
: "${API_BIND_PORT:=3300}"
: "${WEB_BIND_PORT:=5273}"
: "${STUDIO_BIND_PORT:=5274}"
: "${PORTAL_BIND_PORT:=5275}"

export COMPOSE_PROJECT_NAME
export POSTGRES_BIND_PORT
export REDIS_BIND_PORT
export API_BIND_PORT
export WEB_BIND_PORT
export STUDIO_BIND_PORT
export PORTAL_BIND_PORT

cd "${ROOT}"

if [[ "$#" -eq 0 ]]; then
  exec docker compose -f infra/docker/compose.dev.yml up -d --build
fi

exec docker compose -f infra/docker/compose.dev.yml "$@"
