#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PILOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PILOT_DIR}/.." && pwd)"

MODE="hostinger"
if [[ "${1:-}" == "--mode" && -n "${2:-}" ]]; then
  MODE="${2}"
fi

log() {
  printf '[pilot-update] %s\n' "$*"
}

fail() {
  printf '[pilot-update][FAIL] %s\n' "$*" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || fail "Missing required command: git"

log "Pulling latest changes with --ff-only"
git -C "$REPO_ROOT" pull --ff-only

log "Rebuilding and restarting stack"
"${SCRIPT_DIR}/up.sh" --mode "$MODE"

log "Update complete"

