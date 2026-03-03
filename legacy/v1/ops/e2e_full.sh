#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.dev.yml"
FRONTEND_DIR="$ROOT_DIR/frontend"
SEED_SCRIPT="$ROOT_DIR/scripts/seed_e2e.sh"

echo "[phase8.5] starting deterministic full-app e2e harness"

echo "[phase8.5] bringing up postgres"
docker compose -f "$COMPOSE_FILE" up -d db

echo "[phase8.5] bringing up backend/frontend/workers"
docker compose -f "$COMPOSE_FILE" up -d --build backend frontend email-worker

echo "[phase8.5] running migrations"
docker compose -f "$COMPOSE_FILE" run --rm backend alembic upgrade head

if [[ ! -x "$SEED_SCRIPT" ]]; then
  echo "[phase8.5] missing executable seed script: $SEED_SCRIPT"
  exit 2
fi

echo "[phase8.5] resetting and seeding deterministic e2e dataset"
"$SEED_SCRIPT"

echo "[phase8.5] executing playwright suite"
(
  cd "$FRONTEND_DIR"
  npx playwright test --config=playwright.config.ts
)

echo "[phase8.5] report: $FRONTEND_DIR/playwright/test-results/html-report/index.html"
