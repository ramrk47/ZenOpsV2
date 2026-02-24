#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/deploy/backups}"
UPLOADS_DIR="${UPLOADS_DIR:-$ROOT/uploads}"

DB_DUMP="${1:-}"
UPLOADS_ARCHIVE="${2:-}"
BACKUP_ENCRYPTION_ITER="${BACKUP_ENCRYPTION_ITER:-200000}"

if [ -z "$DB_DUMP" ]; then
  echo "Usage: $0 <db_dump.sql.gz|db_dump.sql.gz.enc> [uploads.tar.gz|uploads.tar.gz.enc]"
  exit 1
fi

if [ ! -f "$DB_DUMP" ]; then
  echo "DB dump not found: $DB_DUMP"
  exit 1
fi

decrypt_if_needed() {
  local input="$1"
  if [[ "$input" == *.enc ]]; then
    if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
      echo "BACKUP_ENCRYPTION_KEY is required to decrypt $input" >&2
      exit 1
    fi
    local tmp
    tmp="$(mktemp)"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter "$BACKUP_ENCRYPTION_ITER" \
      -pass env:BACKUP_ENCRYPTION_KEY -in "$input" -out "$tmp"
    echo "$tmp"
    return
  fi
  echo "$input"
}

cleanup_files=()

resolved_db_dump="$(decrypt_if_needed "$DB_DUMP")"
if [[ "$resolved_db_dump" != "$DB_DUMP" ]]; then
  cleanup_files+=("$resolved_db_dump")
fi

if [[ "$resolved_db_dump" == *.gz ]]; then
  echo "Restoring database from gzipped dump..."
  gunzip -c "$resolved_db_dump" | docker compose -f "$ROOT/docker-compose.yml" exec -T db psql -U "${POSTGRES_USER:-zenops}" "${POSTGRES_DB:-zenops}"
else
  echo "Restoring database from plain SQL dump..."
  cat "$resolved_db_dump" | docker compose -f "$ROOT/docker-compose.yml" exec -T db psql -U "${POSTGRES_USER:-zenops}" "${POSTGRES_DB:-zenops}"
fi

if [ -n "$UPLOADS_ARCHIVE" ]; then
  if [ ! -f "$UPLOADS_ARCHIVE" ]; then
    echo "Uploads archive not found: $UPLOADS_ARCHIVE"
    exit 1
  fi
  resolved_uploads="$(decrypt_if_needed "$UPLOADS_ARCHIVE")"
  if [[ "$resolved_uploads" != "$UPLOADS_ARCHIVE" ]]; then
    cleanup_files+=("$resolved_uploads")
  fi
  echo "Restoring uploads..."
  mkdir -p "$UPLOADS_DIR"
  tar -xzf "$resolved_uploads" -C "$UPLOADS_DIR"
fi

for f in "${cleanup_files[@]}"; do
  rm -f "$f"
done

echo "Restore complete."
