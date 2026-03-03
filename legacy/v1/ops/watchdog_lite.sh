#!/usr/bin/env bash
#
# Lightweight watchdog probe for cron.
# Checks /healthz/deps and prints warnings for backlog growth.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

DEFAULT_COMPOSE_FILE="docker-compose.hostinger.yml"
if [ ! -f "$DEFAULT_COMPOSE_FILE" ]; then
  DEFAULT_COMPOSE_FILE="docker-compose.yml"
fi

COMPOSE_FILE="${COMPOSE_FILE:-$DEFAULT_COMPOSE_FILE}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-zenops}"
WATCHDOG_DEPS_URL="${WATCHDOG_DEPS_URL:-}"
WATCHDOG_OUTBOX_MAX="${WATCHDOG_OUTBOX_MAX:-200}"
WATCHDOG_EMAIL_MAX="${WATCHDOG_EMAIL_MAX:-100}"

COMPOSE=(docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME")

log() {
  printf '[%s] %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*"
}

error() {
  printf '[%s] ERROR: %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*" >&2
  exit 1
}

fetch_payload_and_code() {
  if [ -n "$WATCHDOG_DEPS_URL" ]; then
    curl -sS -m 15 -w '\n%{http_code}' "$WATCHDOG_DEPS_URL"
    return
  fi
  "${COMPOSE[@]}" exec -T api sh -lc "curl -sS -m 15 -w '\n%{http_code}' http://127.0.0.1:8000/healthz/deps"
}

RAW_RESPONSE="$(fetch_payload_and_code || true)"
if [ -z "$RAW_RESPONSE" ]; then
  error "Failed to fetch /healthz/deps payload"
fi

HTTP_CODE="$(printf '%s\n' "$RAW_RESPONSE" | tail -n 1)"
PAYLOAD="$(printf '%s\n' "$RAW_RESPONSE" | sed '$d')"

if ! [[ "$HTTP_CODE" =~ ^[0-9]{3}$ ]]; then
  error "Invalid HTTP status while fetching /healthz/deps: $HTTP_CODE"
fi
if [ "$HTTP_CODE" -ne 200 ] && [ "$HTTP_CODE" -ne 503 ]; then
  error "Unexpected HTTP status from /healthz/deps: $HTTP_CODE"
fi

set +e
RESULT="$(printf '%s' "$PAYLOAD" | python3 - "$WATCHDOG_OUTBOX_MAX" "$WATCHDOG_EMAIL_MAX" <<'PY'
import json
import sys

outbox_max = int(sys.argv[1])
email_max = int(sys.argv[2])

try:
    data = json.load(sys.stdin)
except Exception as exc:
    print(f"ERROR: invalid JSON payload ({exc})")
    sys.exit(3)

if isinstance(data, dict) and isinstance(data.get("detail"), dict):
    data = data["detail"]

outbox = int(data.get("outbox_backlog_count", 0) or 0)
email_pending = int(data.get("email_queue_pending_count", 0) or 0)
disk_ok = bool(data.get("disk_space_ok", True))
rate_ok = bool(data.get("rate_limit_table_ok", True))

warnings = []
if outbox > outbox_max:
    warnings.append(f"outbox backlog {outbox} > {outbox_max}")
if email_pending > email_max:
    warnings.append(f"email backlog {email_pending} > {email_max}")
if not disk_ok:
    warnings.append("disk_space_ok=false")
if not rate_ok:
    warnings.append("rate_limit_table_ok=false")

if warnings:
    print("WARNING: " + "; ".join(warnings))
    sys.exit(2)

print(
    "OK: "
    f"outbox_backlog_count={outbox} "
    f"email_queue_pending_count={email_pending} "
    f"disk_space_ok={str(disk_ok).lower()} "
    f"rate_limit_table_ok={str(rate_ok).lower()}"
)
PY
)"
STATUS=$?
set -e

log "$RESULT"
if [ "$STATUS" -eq 2 ]; then
  exit 2
fi
if [ "$STATUS" -ne 0 ]; then
  exit "$STATUS"
fi
