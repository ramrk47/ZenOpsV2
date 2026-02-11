#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

POSTGRES_BIND_PORT="${POSTGRES_BIND_PORT:-55432}"
DATABASE_URL_ROOT="${DATABASE_URL_ROOT:-postgresql://postgres:postgres@localhost:${POSTGRES_BIND_PORT}/zenops}"
DATABASE_URL="${DATABASE_URL:-postgresql://zen_api:zen_api@localhost:${POSTGRES_BIND_PORT}/zenops}"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-/tmp/zenops-artifacts}"

validate_local_db_only() {
  local url="$1"
  if [[ "$url" != *"@localhost:"* && "$url" != *"@127.0.0.1:"* ]]; then
    echo "ERROR: reset-demo is dev-only and refuses non-local DATABASE_URL_ROOT."
    echo "Current DATABASE_URL_ROOT: $url"
    echo "Set DATABASE_URL_ROOT to localhost/127.0.0.1, or run manually if intentional."
    exit 1
  fi
}

main() {
  validate_local_db_only "$DATABASE_URL_ROOT"

  echo "Resetting local infra volumes..."
  pnpm infra:down >/tmp/zenops-reset-infra-down.log 2>&1 || true
  pnpm infra:up >/tmp/zenops-reset-infra-up.log 2>&1

  echo "Rebuilding DB schema + RLS + seed..."
  env \
    DATABASE_URL_ROOT="$DATABASE_URL_ROOT" \
    DATABASE_URL="$DATABASE_URL" \
    POSTGRES_BIND_PORT="$POSTGRES_BIND_PORT" \
    pnpm bootstrap:db >/tmp/zenops-reset-bootstrap.log 2>&1

  echo "Clearing local demo artifacts..."
  rm -rf "${ARTIFACTS_DIR}" || true

  echo "PASS: local demo state reset complete."
}

main "$@"
