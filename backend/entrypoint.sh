#!/usr/bin/env sh
set -e

python /app/scripts/wait_for_db.py

exec "$@"
