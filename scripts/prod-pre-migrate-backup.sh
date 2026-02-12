#!/usr/bin/env bash
set -euo pipefail

./scripts/prod-backup-db.sh

echo "Pre-migration backup done. You can run migrations now."
