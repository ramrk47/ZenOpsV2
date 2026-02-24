# Zen Ops Backups (Docker-only)

This setup runs Postgres dumps, uploads archives, and Excel snapshots entirely via Docker containers. No host rclone install required.

## What you get

- Nightly Postgres dump (`pg_dump | gzip`) to `deploy/backups/`
- Optional uploads archive (`tar.gz`)
- Full database Excel snapshot (`.xlsx`)
- Uploads manifest with assignment/invoice metadata (`.jsonl`)
- Per-assignment archives (final or all docs) for fast recovery
- Structured uploads archive (`valuations/<bank>/<borrower>/<assignment_code>/...`) for easy browsing
- Encrypted offsite uploads via rclone (requires `BACKUP_ENCRYPTION_KEY`)
- Retention: 7 days local, 30 days remote (configurable)
- Tier rotation: 2 daily slots + weekly + fortnightly + monthly (configurable)

## 1) Create local folders

```bash
mkdir -p deploy/backups deploy/rclone
```

## 2) Configure rclone (Docker-only)

```bash
docker compose --profile backup run --rm rclone config
```

Steps:
- `n` new remote
- name: `gdrive`
- type: `drive`
- complete OAuth flow

### macOS OAuth note (why the URL won’t open from Docker)

On macOS, `rclone authorize` running inside a container starts a localhost callback that is not reachable from the host browser. The easiest fix is a one-time host authorization, then paste the token into the Docker config prompt.

One-time host authorization (recommended):

```bash
brew install rclone
rclone authorize "drive"
```

Copy the JSON token output and paste it into the `config_token` prompt shown by `docker compose run --rm rclone config`.

If you prefer a service account (no browser auth), ask and we will wire it in.

Test:
```bash
docker compose --profile backup run --rm rclone ls gdrive:
docker compose --profile backup run --rm rclone mkdir gdrive:zenops-backups
```

## 3) Run a manual backup

```bash
docker compose --profile backup run --rm backup
```

Check local files:
```bash
ls -lah deploy/backups
```

## 4) Nightly backups (Docker-only cron)

The `backup-cron` service runs:

```
30 2 * * * docker compose -f /work/docker-compose.yml run --rm backup
```

Bring it up:
```bash
docker compose --profile backup up -d backup-cron
```

Optional: set timezone for cron in `docker-compose.yml` with `TZ=Asia/Kolkata` (or your timezone).

## 5) Restore

Download one encrypted dump from Drive:
```bash
docker compose --profile backup run --rm rclone copy gdrive:zenops-backups /data --include "zenops_db_*.sql.gz.enc"
```

Restore (decrypts automatically):
```bash
export BACKUP_ENCRYPTION_KEY=your_key_here
./deploy/backup/restore.sh deploy/backups/zenops_db_<DATE>.sql.gz.enc deploy/backups/zenops_uploads_<DATE>.tar.gz.enc
```

### Excel-only restore (best-effort)

```bash
docker compose run --rm -v ./deploy/backups:/backups api \
  python /app/scripts/restore_from_excel.py --path /backups/zenops_snapshot_<DATE>.xlsx --truncate --disable-constraints
```

Notes:
- Excel restore is best-effort. It does not reconstruct binary files and may not perfectly restore complex JSON structures.
- Use `pg_dump` as the canonical restore method; Excel is for emergency continuity.

## 6) Retention and config

Environment variables for the `backup` service:

- `APP_NAME` (default `zenops`)
- `BACKUP_DIR` (default `/backups`)
- `BACKUP_TIER_DIR` (default `/backups/tiers`)
- `UPLOADS_DIR` (default `/uploads`)
- `RETAIN_LOCAL_DAYS` (default `7`)
- `RETAIN_REMOTE_DAYS` (default `30`)
- `RCLONE_REMOTE` (default `gdrive:zenops-backups`)
- `RCLONE_UPLOAD_MODE` (default `tiers`, use `all` to upload every timestamped file)
- `BACKUP_ENCRYPTION_KEY` (required when `RCLONE_REMOTE` is set)
- `BACKUP_ENCRYPTION_ITER` (default `200000`, PBKDF2 iterations)
- `DAILY_SLOTS` (default `2`)
- `WEEKLY_DAY` (default `1`, Monday)
- `FORTNIGHT_DAYS` (default `1,15`)
- `MONTHLY_DAY` (default `1`)
- `MANIFEST_HASH` (default `1`, set `0` to skip SHA256 for large files)
- `ASSIGNMENT_ARCHIVE_MODE` (default `all`, set `final` or `off`)
- `ASSIGNMENT_ARCHIVE_DIR` (default `/backups/assignment_archives`)
- `STRUCTURED_UPLOADS_MODE` (default `on`, set `off` to skip)
- `STRUCTURED_UPLOADS_ROOT` (default `valuations`)
- `STRUCTURED_UPLOADS_DIR` (default `/backups/structured_uploads`)

## 7) Offsite encryption (required)

If `RCLONE_REMOTE` is set, the backup job encrypts files with AES-256 before upload.
Set a strong passphrase in the compose `.env`:

```
BACKUP_ENCRYPTION_KEY=change_me_to_a_long_random_value
```

Encrypted files are uploaded with a `.enc` suffix. Keep this key safe; restores need it.

You can still use an encrypted rclone remote (optional, extra defense-in-depth):

```bash
docker compose run --rm rclone config
```

Create a `crypt` remote that points to `gdrive:zenops-backups`. Then set:

```
RCLONE_REMOTE=crypt:zenops-backups
```

## 8) Make targets

- `make backup-run`
- `make backup-test`
- `make backup-restore DB_DUMP=... UPLOADS_ARCHIVE=...`
- `make backup-excel-restore EXCEL_PATH=/backups/zenops_snapshot_<DATE>.xlsx`

## 9) Monthly restore-test checklist

Run this once a month (or after major changes): `deploy/backup/RESTORE_TEST_CHECKLIST.md`.

## Troubleshooting

- If `backup` fails to connect to Postgres, check `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` in `.env`.
- If uploads are missing, confirm the uploads volume is mounted and contains files.
- If Google Drive upload fails, re-run `docker compose run --rm rclone config`.
