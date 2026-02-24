#!/usr/bin/env bash
set -euo pipefail

WORKDIR="${WORKDIR:-/work}"
BACKUP_DIR="${BACKUP_DIR:-${WORKDIR}/deploy/backups}"
TRIGGER_PATH="${TRIGGER_PATH:-${BACKUP_DIR}/backup.trigger}"
STATUS_PATH="${STATUS_PATH:-${BACKUP_DIR}/backup.status.json}"
LOCK_PATH="${LOCK_PATH:-${BACKUP_DIR}/backup.lock}"

write_status() {
  local state="$1"
  local started_at="$2"
  local finished_at="$3"
  local message="${4:-}"
  printf '{"state":"%s","started_at":"%s","finished_at":"%s","message":"%s"}\n' \
    "$state" "$started_at" "$finished_at" "$message" > "$STATUS_PATH"
}

while true; do
  if [ -f "$TRIGGER_PATH" ]; then
    if [ -f "$LOCK_PATH" ]; then
      sleep 5
      continue
    fi

    touch "$LOCK_PATH"
    rm -f "$TRIGGER_PATH"
    started_at="$(date -Iseconds)"
    write_status "running" "$started_at" "" "backup started"

    if docker compose -f "${WORKDIR}/docker-compose.yml" run --rm backup; then
      finished_at="$(date -Iseconds)"
      write_status "success" "$started_at" "$finished_at" "backup completed"
    else
      finished_at="$(date -Iseconds)"
      write_status "failed" "$started_at" "$finished_at" "backup failed"
    fi

    rm -f "$LOCK_PATH"
  fi

  sleep 10
done
