#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.dev.yml"

echo "[phase8.5] running deterministic db reset + seed"
docker compose -f "$COMPOSE_FILE" run --rm backend python -m app.scripts.seed_e2e --reset
