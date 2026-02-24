# Zen Ops Production Protocol v1 - Implementation Summary

## Files Created

### ops/ Scripts (New Directory)
- ✅ `ops/deploy.sh` - Safe production deployment workflow
- ✅ `ops/backup_now.sh` - One-shot backup with verification
- ✅ `ops/migrate.sh` - Database migration runner
- ✅ `ops/enable_scheduled_backups.sh` - Start backup-cron services
- ✅ `ops/disable_scheduled_backups.sh` - Stop backup-cron services
- ✅ `ops/restore.sh` - Safe database restore (test/disaster modes)

### Documentation
- ✅ `docs/DEPLOYMENT_RUNBOOK.md` - Comprehensive operations guide

## No Compose Changes Required

The existing `docker-compose.yml` already has everything needed:
- ✅ `migrate` service (one-off migrations)
- ✅ `backup` service with profile
- ✅ `backup-cron` and `backup-dispatcher` with profile
- ✅ Named volumes (postgres_data, uploads, etc.)
- ✅ Health checks on all services

## Existing Backup Script Analysis

`deploy/backup/backup.sh` already has:
- ✅ `set -euo pipefail` (strict mode)
- ✅ ERR trap for failure detection
- ✅ Status file (`backup.status.json`)
- ✅ Timestamped filenames
- ✅ rclone integration with failure detection
- ✅ Retention policy enforcement

**No changes needed** - script already follows best practices.

---

## Verification Commands

### 1. Deploy Application

```bash
cd /path/to/zen-ops
./ops/deploy.sh
```

**Expected output:**
- Validates compose file
- Shows git commit
- Runs backup
- Runs migrations
- Starts services
- Health check passes
- Prints smoke test checklist

### 2. Manual Backup

```bash
./ops/backup_now.sh
```

**Expected output:**
- Runs backup service
- Lists recent backups
- Verifies latest backup non-empty
- Shows remote status (if configured)

### 3. Run Migrations

```bash
./ops/migrate.sh
```

**Expected output:**
- Runs alembic upgrade head
- Shows applied migrations

### 4. Enable Scheduled Backups

```bash
./ops/enable_scheduled_backups.sh
```

**Expected output:**
- Starts backup-cron and backup-dispatcher
- Verifies both services running
- Shows crontab schedule

### 5. Test Restore

```bash
# Find latest backup
LATEST=$(ls -t ./deploy/backups/*.dump 2>/dev/null | head -1 || echo "")

# Test restore (creates temporary DB)
./ops/restore.sh MODE=test BACKUP_FILE="$LATEST"
```

**Expected output:**
- Creates test database container
- Restores backup
- Verifies schema
- Prints cleanup commands

### 6. Health Check

```bash
curl http://localhost/readyz
```

**Expected response:**
```json
{"status":"ok","alembic_revision":"0030_add_document_templates_bank_scope"}
```

### 7. Verify Backups Exist

```bash
ls -lah ./deploy/backups | tail -10
```

**Expected output:**
- Multiple .dump files with timestamps
- Recent timestamps (if backups running)

### 8. Verify rclone Remote (if configured)

```bash
docker compose --profile backup run --rm rclone lsf gdrive:ZenOpsBackups/ | tail -10
```

**Expected output:**
- List of backup files in Google Drive

---

## Smoke Test Checklist

After deployment, verify:

1. ✅ **Login** - Navigate to http://localhost, login works
2. ✅ **Dashboard** - Home page loads, widgets display
3. ✅ **Assignments List** - `/assignments` loads
4. ✅ **Assignment Detail** - Click assignment, all tabs load
5. ✅ **Documents** - Upload file, preview works (iframe-based PDF viewer)
6. ✅ **Master Data** - Navigate to Master Data > File Templates
7. ✅ **Bank Templates** - Create template with bank/branch selection
8. ✅ **Payroll** - View payroll runs (if applicable)
9. ✅ **API Health** - `curl http://localhost/readyz` returns 200

---

## Safety Features Implemented

### Deploy Script (`ops/deploy.sh`)
- ✅ Validates compose file before proceeding
- ✅ Shows git status, blocks on dirty working directory (unless CONFIRM=YES)
- ✅ **Always runs backup before migrations**
- ✅ Migrations run as one-off service (not auto-start)
- ✅ Health check with timeout
- ✅ Prints rollback instructions
- ✅ **No `docker compose down -v` anywhere**

### Backup Script (`ops/backup_now.sh`)
- ✅ Verifies backup profile exists
- ✅ Runs backup service
- ✅ **Verifies backup file non-empty**
- ✅ Tests rclone remote if configured
- ✅ Lists recent backups

### Restore Script (`ops/restore.sh`)
- ✅ **Defaults to TEST mode** (temporary database)
- ✅ Disaster mode requires CONFIRM=YES
- ✅ **Never touches production DB automatically**
- ✅ Manual volume swap instructions for disaster recovery
- ✅ Verifies restored schema
- ✅ **No `docker compose down -v`**

### Backup Service (`deploy/backup/backup.sh`)
- ✅ Already has `set -euo pipefail`
- ✅ ERR trap for failure detection
- ✅ pg_dump failure will exit non-zero
- ✅ rclone upload failure tracked
- ✅ Timestamped filenames (`zenops_YYYYMMDD_HHMMSS`)
- ✅ Retention policy enforced

---

## Environment Variables

### Deploy Script
- `PULL=1` - Git pull before deploy
- `CONFIRM=YES` - Proceed with dirty working directory
- `HEALTH_TIMEOUT=60` - Health check timeout (seconds)
- `HEALTH_URL=http://localhost/readyz` - Health check endpoint

### Backup Configuration (in .env or .env.backend)
- `RCLONE_REMOTE=gdrive:ZenOpsBackups/production` - Remote backup destination
- `RETAIN_LOCAL_DAYS=7` - Local retention (days)
- `RETAIN_REMOTE_DAYS=30` - Remote retention (days)
- `BACKUP_ENCRYPTION_KEY=<key>` - Optional encryption
- `ASSIGNMENT_ARCHIVE_MODE=all` - Archive all/final/off

### Restore Script
- `MODE=test` - Test restore (default)
- `MODE=disaster` - Production restore
- `BACKUP_FILE=<path>` - Path to .dump file
- `CONFIRM=YES` - Required for disaster mode

---

## Rollback Procedures

### Code Rollback
```bash
git log --oneline -10  # Find previous commit
git checkout <commit-hash>
./ops/deploy.sh
```

### Database Rollback (Disaster Recovery)
```bash
# 1. Find pre-migration backup
ls -lah ./deploy/backups | grep $(date +%Y-%m-%d)

# 2. Restore to new volume
./ops/restore.sh MODE=disaster BACKUP_FILE="<file>" CONFIRM=YES

# 3. Follow printed instructions to swap volumes
# (Manual edit of docker-compose.yml required)

# 4. Restart services
docker compose up -d
```

---

## Directory Structure

```
/opt/zen-ops/
├── docker-compose.yml       # ✅ No changes needed
├── .env                      # Main environment
├── .env.backend              # Backend environment
├── ops/                      # ✅ NEW: Operations scripts
│   ├── deploy.sh
│   ├── backup_now.sh
│   ├── migrate.sh
│   ├── enable_scheduled_backups.sh
│   ├── disable_scheduled_backups.sh
│   └── restore.sh
├── deploy/
│   ├── backups/              # Local backup storage
│   ├── rclone/               # rclone config persistence
│   └── backup/               # ✅ No changes needed
│       ├── backup.sh         # Already production-safe
│       ├── Dockerfile
│       ├── cron.Dockerfile
│       ├── crontab
│       └── dispatcher.sh
└── docs/
    └── DEPLOYMENT_RUNBOOK.md  # ✅ NEW: Comprehensive guide
```

---

## Golden Rules (Enforced by Scripts)

1. ✅ **NEVER `docker compose down -v`** - Not used anywhere
2. ✅ **Always backup before migrations** - Enforced in deploy.sh
3. ✅ **Migrations are one-off** - Uses `migrate` service (restart: "no")
4. ✅ **Use ops/ scripts** - All have safety checks
5. ✅ **Test restores monthly** - restore.sh MODE=test makes it easy

---

## Next Steps

1. **Initial Setup** (if not done):
   ```bash
   cd /opt/zen-ops
   ./ops/deploy.sh
   ./ops/enable_scheduled_backups.sh
   ```

2. **Configure Google Drive** (optional but recommended):
   ```bash
   docker compose --profile backup run --rm rclone config
   # Set RCLONE_REMOTE in .env
   ```

3. **Test Restore** (verify backups work):
   ```bash
   ./ops/backup_now.sh
   LATEST=$(ls -t ./deploy/backups/*.dump | head -1)
   ./ops/restore.sh MODE=test BACKUP_FILE="$LATEST"
   ```

4. **Add to Cron** (monthly restore drill):
   ```cron
   0 3 1 * * cd /opt/zen-ops && ./ops/restore.sh MODE=test BACKUP_FILE=$(ls -t ./deploy/backups/*.dump | head -1) >> /var/log/restore-drill.log 2>&1
   ```

---

## Support & Troubleshooting

See `docs/DEPLOYMENT_RUNBOOK.md` for:
- Detailed troubleshooting steps
- Emergency procedures
- Monthly maintenance checklist
- Contact information template

---

**Protocol Version**: v1.0  
**Implementation Date**: 2026-02-08  
**Status**: ✅ Production Ready
