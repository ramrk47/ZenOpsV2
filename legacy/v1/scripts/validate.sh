#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="$ROOT/backend/.smoke.db"

export DATABASE_URL="sqlite+pysqlite:///$DB_PATH"
export JWT_SECRET="smoke_secret"

rm -f "$DB_PATH"

pushd "$ROOT/backend" >/dev/null
alembic upgrade head
python -m app.seed
popd >/dev/null

SMOKE_BOOTSTRAP=0 python "$ROOT/scripts/smoke_backend.py"
