#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="${COMPOSE_PROJECT_NAME:-zenops-prod}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker/compose.vps.yml}"
ACTION="${1:-status}"

case "${ACTION}" in
  downshift)
    echo "Stopping worker for off-hours mode"
    docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" stop worker
    ;;
  upshift)
    echo "Starting worker for normal hours"
    docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" up -d worker
    ;;
  status)
    docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" ps worker
    ;;
  *)
    echo "Usage: $0 {downshift|upshift|status}"
    exit 1
    ;;
esac
