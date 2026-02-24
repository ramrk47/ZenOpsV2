#!/usr/bin/env bash
set -euo pipefail

DATE="$(date +'%Y-%m-%d_%H-%M-%S')"
APP_NAME="${APP_NAME:-zenops}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
UPLOADS_DIR="${UPLOADS_DIR:-/uploads}"
RETAIN_LOCAL_DAYS="${RETAIN_LOCAL_DAYS:-7}"
RETAIN_REMOTE_DAYS="${RETAIN_REMOTE_DAYS:-30}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
RCLONE_UPLOAD_MODE="${RCLONE_UPLOAD_MODE:-tiers}"
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"
BACKUP_ENCRYPTION_ITER="${BACKUP_ENCRYPTION_ITER:-200000}"
BACKUP_TIER_DIR="${BACKUP_TIER_DIR:-${BACKUP_DIR}/tiers}"
DAILY_SLOTS="${DAILY_SLOTS:-2}"
WEEKLY_DAY="${WEEKLY_DAY:-1}"
FORTNIGHT_DAYS="${FORTNIGHT_DAYS:-1,15}"
MONTHLY_DAY="${MONTHLY_DAY:-1}"
BACKUP_STATUS_PATH="${BACKUP_STATUS_PATH:-${BACKUP_DIR}/backup.status.json}"
ASSIGNMENT_ARCHIVE_MODE="${ASSIGNMENT_ARCHIVE_MODE:-final}"
ASSIGNMENT_ARCHIVE_DIR="${ASSIGNMENT_ARCHIVE_DIR:-${BACKUP_DIR}/assignment_archives}"
STRUCTURED_UPLOADS_MODE="${STRUCTURED_UPLOADS_MODE:-on}"
STRUCTURED_UPLOADS_DIR="${STRUCTURED_UPLOADS_DIR:-${BACKUP_DIR}/structured_uploads}"
STRUCTURED_UPLOADS_ROOT="${STRUCTURED_UPLOADS_ROOT:-valuations}"

mkdir -p "$BACKUP_DIR"
mkdir -p "$BACKUP_TIER_DIR"
mkdir -p "$ASSIGNMENT_ARCHIVE_DIR"
mkdir -p "$STRUCTURED_UPLOADS_DIR"

log() {
  printf '[%s] %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$1"
}

encrypt_file() {
  local input="$1"
  local output="$2"
  openssl enc -aes-256-cbc -salt -pbkdf2 -iter "$BACKUP_ENCRYPTION_ITER" \
    -pass env:BACKUP_ENCRYPTION_KEY -in "$input" -out "$output"
}

stage_encrypted_files() {
  local target_dir="$1"
  shift
  mkdir -p "$target_dir"
  for file in "$@"; do
    if [ -z "$file" ] || [ ! -f "$file" ]; then
      continue
    fi
    local base
    base="$(basename "$file")"
    encrypt_file "$file" "${target_dir}/${base}.enc"
  done
}

write_status() {
  local state="$1"
  local started_at="$2"
  local finished_at="$3"
  local message="${4:-}"
  printf '{"state":"%s","started_at":"%s","finished_at":"%s","message":"%s"}\n' \
    "$state" "$started_at" "$finished_at" "$message" > "$BACKUP_STATUS_PATH"
}

# Check encryption key early if remote upload is configured
if [ -n "$RCLONE_REMOTE" ] && [ -z "$BACKUP_ENCRYPTION_KEY" ]; then
  log "BACKUP_ENCRYPTION_KEY not set but RCLONE_REMOTE is configured."
  log "Refusing to proceed without encryption for remote backups."
  exit 1
fi

started_at="$(date -Iseconds)"
write_status "running" "$started_at" "" "backup started"
trap 'write_status "failed" "$started_at" "$(date -Iseconds)" "backup failed"; rm -rf "$ENCRYPTED_STAGE" 2>/dev/null || true' ERR
trap 'rm -rf "$ENCRYPTED_STAGE" 2>/dev/null || true' EXIT

log "[1/7] Database dump..."
DB_FILE="${BACKUP_DIR}/${APP_NAME}_db_${DATE}.sql.gz"
pg_dump | gzip > "$DB_FILE"

UPLOADS_FILE=""
if [ -d "$UPLOADS_DIR" ]; then
  log "[2/7] Uploads archive..."
  UPLOADS_FILE="${BACKUP_DIR}/${APP_NAME}_uploads_${DATE}.tar.gz"
  tar -czf "$UPLOADS_FILE" -C "$UPLOADS_DIR" .
else
  log "[2/7] Uploads dir missing (${UPLOADS_DIR}). Skipping uploads archive."
fi

EXCEL_FILE=""
if command -v python >/dev/null 2>&1; then
  log "[3/7] Excel snapshot..."
  EXCEL_FILE="${BACKUP_DIR}/${APP_NAME}_snapshot_${DATE}.xlsx"
  export EXPORT_PATH="$EXCEL_FILE"
  python /backup/export_snapshot_excel.py
else
  log "[3/7] Python not available; skipping Excel snapshot."
fi

MANIFEST_FILE=""
if command -v python >/dev/null 2>&1; then
log "[4/7] Uploads manifest..."
  MANIFEST_FILE="${BACKUP_DIR}/${APP_NAME}_uploads_manifest_${DATE}.jsonl"
  export MANIFEST_PATH="$MANIFEST_FILE"
  export UPLOADS_DIR
  python /backup/export_uploads_manifest.py
else
  log "[4/7] Python not available; skipping uploads manifest."
fi

if [ "$ASSIGNMENT_ARCHIVE_MODE" != "off" ] && command -v python >/dev/null 2>&1; then
  log "[4b/7] Assignment archives (${ASSIGNMENT_ARCHIVE_MODE})..."
  python /backup/export_assignment_archives.py \
    --scope "$ASSIGNMENT_ARCHIVE_MODE" \
    --output-dir "$ASSIGNMENT_ARCHIVE_DIR" \
    --uploads-dir "$UPLOADS_DIR"
else
  log "[4b/7] Assignment archives skipped."
fi

STRUCTURED_FILE=""
if [ "$STRUCTURED_UPLOADS_MODE" != "off" ] && command -v python >/dev/null 2>&1; then
  log "[4c/7] Structured uploads archive..."
  STRUCTURED_FILE="${STRUCTURED_UPLOADS_DIR}/${APP_NAME}_uploads_structured_${DATE}.tar.gz"
  export STRUCTURED_UPLOADS_PATH="$STRUCTURED_FILE"
  export STRUCTURED_UPLOADS_ROOT
  python /backup/export_structured_uploads.py --uploads-dir "$UPLOADS_DIR"
else
  log "[4c/7] Structured uploads archive skipped."
fi

copy_tier() {
  local tag="$1"
  cp -f "$DB_FILE" "${BACKUP_TIER_DIR}/${APP_NAME}_db_${tag}.sql.gz"
  if [ -n "$UPLOADS_FILE" ]; then
    cp -f "$UPLOADS_FILE" "${BACKUP_TIER_DIR}/${APP_NAME}_uploads_${tag}.tar.gz"
  fi
  if [ -n "$EXCEL_FILE" ]; then
    cp -f "$EXCEL_FILE" "${BACKUP_TIER_DIR}/${APP_NAME}_snapshot_${tag}.xlsx"
  fi
  if [ -n "$MANIFEST_FILE" ]; then
    cp -f "$MANIFEST_FILE" "${BACKUP_TIER_DIR}/${APP_NAME}_uploads_manifest_${tag}.jsonl"
  fi
  if [ -n "$STRUCTURED_FILE" ]; then
    cp -f "$STRUCTURED_FILE" "${BACKUP_TIER_DIR}/${APP_NAME}_uploads_structured_${tag}.tar.gz"
  fi
}

day_of_month="$(date +%d | sed 's/^0//')"
day_of_week="$(date +%u)"
daily_slot_index=$((10#$(date +%d) % DAILY_SLOTS))
if [ "$daily_slot_index" -eq 0 ]; then
  daily_tag="daily_a"
else
  daily_tag="daily_b"
fi

log "[5/7] Tier rotation..."
copy_tier "$daily_tag"

if [ "$day_of_week" -eq "$WEEKLY_DAY" ]; then
  copy_tier "weekly"
fi

if echo ",${FORTNIGHT_DAYS}," | grep -q ",${day_of_month},"; then
  copy_tier "fortnightly"
fi

if [ "$day_of_month" -eq "$MONTHLY_DAY" ]; then
  copy_tier "monthly"
fi

if [ -n "$RCLONE_REMOTE" ]; then
  log "[6/7] Upload encrypted backups to remote..."
  # Encryption key already validated at script start

  ENCRYPTED_STAGE="$(mktemp -d)"
  if [ "$RCLONE_UPLOAD_MODE" = "all" ]; then
    stage_encrypted_files "$ENCRYPTED_STAGE" "$DB_FILE" "$UPLOADS_FILE" "$EXCEL_FILE" "$MANIFEST_FILE" "$STRUCTURED_FILE"
    rclone copy "$ENCRYPTED_STAGE" "$RCLONE_REMOTE" --checksum --include "${APP_NAME}_*.enc"
  else
    mapfile -t tier_files < <(find "$BACKUP_TIER_DIR" -maxdepth 1 -type f -name "${APP_NAME}_*" 2>/dev/null || true)
    if [ "${#tier_files[@]}" -gt 0 ]; then
      stage_encrypted_files "$ENCRYPTED_STAGE" "${tier_files[@]}"
      rclone copy "$ENCRYPTED_STAGE" "$RCLONE_REMOTE" --checksum --include "${APP_NAME}_*.enc"
    fi
  fi
  rm -rf "$ENCRYPTED_STAGE"
else
  log "[6/7] RCLONE_REMOTE not set. Skipping remote upload."
fi

log "[7/7] Local retention (>${RETAIN_LOCAL_DAYS} days)..."
find "$BACKUP_DIR" -maxdepth 1 -type f -name "${APP_NAME}_*" -mtime "+${RETAIN_LOCAL_DAYS}" -delete || true

if [ -n "$RCLONE_REMOTE" ]; then
  if [ "$RCLONE_UPLOAD_MODE" = "all" ]; then
    log "[7/7] Remote retention (>${RETAIN_REMOTE_DAYS} days)..."
    rclone delete "$RCLONE_REMOTE" --min-age "${RETAIN_REMOTE_DAYS}d" --include "${APP_NAME}_*.enc" || true
  else
    log "[7/7] Remote retention skipped (tiered mode)."
  fi
else
  log "[7/7] Remote retention skipped (no RCLONE_REMOTE)."
fi

log "Backup complete: ${DATE}"
write_status "success" "$started_at" "$(date -Iseconds)" "backup completed"
