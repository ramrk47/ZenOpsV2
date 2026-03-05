#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT_NAME="${COMPOSE_PROJECT_NAME:-zenops}"
COMPOSE_FILE="docker-compose.hostinger.yml"

if [[ $# -lt 1 ]]; then
  cat <<'USAGE'
Usage:
  ./ops/reset_pilot_clean.sh --admin "email1@example.com:Password1" --admin "email2@example.com:Password2"

Optional flags are passed through to the Python reset script:
  --skip-master-seed
USAGE
  exit 1
fi

echo "[reset-pilot] Ensuring DB/migrations are up"
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" up -d db uploads-perms
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" run --rm migrate

echo "[reset-pilot] Clearing data and bootstrapping admin accounts"
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" run --rm api \
  python -m app.scripts.reset_pilot_data "$@"

echo "[reset-pilot] Restarting app services"
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" up -d api email-worker frontend

echo "[reset-pilot] Completed."
