#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log() { printf '[up-pilot-hostinger] %s\n' "$*"; }
require_file() {
  local path="$1"
  [[ -f "$path" ]] || { printf '[up-pilot-hostinger][FAIL] Missing required file: %s\n' "$path" >&2; exit 1; }
}

require_file .env
require_file .env.backend

log "Delegating to standalone V1 deploy script"
./ops/deploy_pilot_v1.sh
