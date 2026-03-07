#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

ENV_FILE="${ROOT_DIR}/.env.demo"
BACKEND_ENV_FILE="${ROOT_DIR}/.env.demo.backend"
COMPOSE_FILES=(-f docker-compose.hostinger.yml -f docker-compose.demo.yml)

[[ -f "${ENV_FILE}" ]] || { echo "[demo-reset][FAIL] Missing .env.demo. Run ./ops/bootstrap_demo_env.sh first."; exit 1; }
[[ -f "${BACKEND_ENV_FILE}" ]] || { echo "[demo-reset][FAIL] Missing .env.demo.backend. Run ./ops/bootstrap_demo_env.sh first."; exit 1; }

# shellcheck disable=SC1090
source "${ENV_FILE}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-maulya-demo}"

echo "[demo-reset] Building current images"
docker compose --env-file "${ENV_FILE}" -p "${PROJECT_NAME}" "${COMPOSE_FILES[@]}" build api frontend

echo "[demo-reset] Ensuring DB + Redis + uploads perms are up"
docker compose --env-file "${ENV_FILE}" -p "${PROJECT_NAME}" "${COMPOSE_FILES[@]}" up -d db redis uploads-perms

echo "[demo-reset] Running migrations"
docker compose --env-file "${ENV_FILE}" -p "${PROJECT_NAME}" "${COMPOSE_FILES[@]}" run --rm migrate

echo "[demo-reset] Resetting and seeding demo dataset"
docker compose --env-file "${ENV_FILE}" -p "${PROJECT_NAME}" "${COMPOSE_FILES[@]}" run --rm api \
  python -m app.scripts.seed_e2e --reset

echo "[demo-reset] Restarting app services"
docker compose --env-file "${ENV_FILE}" -p "${PROJECT_NAME}" "${COMPOSE_FILES[@]}" up -d api email-worker frontend

cat <<'EOF'
[demo-reset] Completed.
[demo-reset] Demo credentials:
  admin@maulya.local / password
  field@maulya.local / password
  associate@maulya.local / password
EOF
