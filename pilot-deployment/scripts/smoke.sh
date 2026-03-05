#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PILOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PILOT_DIR}/.." && pwd)"

V1_ENV_FILE="${PILOT_DIR}/env/v1.env"
REPOGEN_ENV_FILE="${PILOT_DIR}/env/repogen.env"

log() {
  printf '[pilot-smoke] %s\n' "$*"
}

fail() {
  printf '[pilot-smoke][FAIL] %s\n' "$*" >&2
  exit 1
}

if [[ -f "$V1_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$V1_ENV_FILE"
  set +a
fi

if [[ -f "$REPOGEN_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$REPOGEN_ENV_FILE"
  set +a
fi

SMOKE_SCRIPT="${REPO_ROOT}/legacy/v1/ops/smoke_deploy_repogen.sh"
[[ -x "$SMOKE_SCRIPT" ]] || fail "Smoke script is missing or not executable: $SMOKE_SCRIPT"

log "Running legacy/v1 smoke checks for V1 + Repogen bridge"
if "$SMOKE_SCRIPT"; then
  log "PASS"
else
  fail "Smoke checks failed"
fi

