#!/bin/bash
set -e

echo "====================================="
echo " E2E Repogen Pipeline Setup          "
echo "====================================="

export COMPOSE_PROJECT_NAME=zenopsv2-e2e
export ARTIFACTS_DIR=$(pwd)/.local-artifacts
export POSTGRES_BIND_PORT=55433
export DATABASE_URL="postgresql://postgres:postgres@localhost:${POSTGRES_BIND_PORT}/zenops"
export REDIS_BIND_PORT=56380
export REDIS_URL="redis://localhost:${REDIS_BIND_PORT}"

# Ensure artifacts directory exists
mkdir -p "$ARTIFACTS_DIR/mock"

echo "1. Starting minimal infrastructure (Detached)..."
# We'll use the compose.dev.yml layout but just bring up necessary services
docker compose -p $COMPOSE_PROJECT_NAME -f infra/docker/compose.dev.yml up -d postgres redis api worker web

echo "2. Waiting for Postgres to be ready..."
sleep 10 # Adjust as needed wait-for-it or healthchecks

echo "3. Seeding Database..."
DATABASE_URL=$DATABASE_URL pnpm --filter @zenops/db exec prisma db push --schema=prisma/schema --force-reset --accept-data-loss
DATABASE_URL_ROOT=$DATABASE_URL pnpm node scripts/bootstrap-db.mjs
DATABASE_URL=$DATABASE_URL pnpm tsx packages/db/src/seed-e2e.ts

echo "4. Running Playwright E2E Test..."
# We have to make sure the web and api are actually up and returning HTTP 200
# Playwright is instructed to test against localhost:5173
cd apps/e2e
# playwright install if needed
npx playwright install chromium --with-deps
npx playwright test e2e-docx-generation.spec.ts

echo "====================================="
echo " E2E Run Complete. Tearing down...   "
echo "====================================="

cd ../..
docker compose -p $COMPOSE_PROJECT_NAME -f infra/docker/compose.dev.yml down -v
