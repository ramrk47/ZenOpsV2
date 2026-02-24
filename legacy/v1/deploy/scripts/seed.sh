#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "Seeding database (disabled by default in production)."
docker compose -f "$ROOT/docker-compose.yml" exec api python -m app.seed
