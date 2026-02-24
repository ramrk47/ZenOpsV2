# Zen Ops Deployment Runbook

**Production Protocol v1**  
Safe, repeatable deployments with zero-footgun guarantees.

---

## 🚨 Golden Rules (READ FIRST)

1. **NEVER run `docker compose down -v`** — This deletes all volumes including the database
2. **Always backup before migrations** — Automated in deploy.sh
3. **Migrations are one-off only** — Never auto-run on API startup
4. **Use the ops/ scripts** — They have safety checks built-in
5. **Test restores monthly** — Backups are worthless if you can't restore

---

## One-Time VPS Setup

### Prerequisites
- Ubuntu 22.04 LTS or similar
- Docker Engine 24+ and Docker Compose v2
- Git
- curl

### Initial Setup

```bash
# 1. Install Docker (if not present)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in for group changes

# 2. Clone repository
git clone <repo-url> /opt/zen-ops
cd /opt/zen-ops

# 3. Create environment files
cp .env.example .env
cp backend/.env.example .env.backend

# 4. Edit environment files
# Set strong passwords, email config, etc.
nano .env.backend

# 5. Create required directories
mkdir -p deploy/backups deploy/rclone

# 6. Initial deployment
./ops/deploy.sh

# 7. Enable scheduled backups
./ops/enable_scheduled_backups.sh
```

---

## Standard Deployment Workflow

### Quick Deploy (Clean Repo)

```bash
cd /opt/zen-ops
./ops/deploy.sh
```

### Deploy with Git Pull

```bash
cd /opt/zen-ops
PULL=1 ./ops/deploy.sh
```

### Deploy with Uncommitted Changes

```bash
cd /opt/zen-ops
CONFIRM=YES ./ops/deploy.sh
```

### What `deploy.sh` Does

1. ✅ Validates docker-compose.yml
2. ✅ Shows git status and commit
3. ✅ Runs pre-migration backup
4. ✅ Runs database migrations
5. ✅ Builds and starts services
6. ✅ Health checks API
7. ✅ Prints smoke test checklist

---

## Backup Operations

### Manual Backup

```bash
./ops/backup_now.sh
```

This creates:
- PostgreSQL dump (custom format, compressed)
- Excel export of master data
- Assignment document archives
- Uploads to Google Drive (if configured)

### Enable Scheduled Backups

```bash
./ops/enable_scheduled_backups.sh
```

Default schedule (see `deploy/backup/crontab`):
- **2:00 AM daily** — Full backup with tiered retention

### Disable Scheduled Backups

```bash
./ops/disable_scheduled_backups.sh
```

### Verify Backups

```bash
# Local backups
ls -lah ./deploy/backups | tail -10

# Remote backups (if rclone configured)
docker compose --profile backup run --rm rclone lsf <REMOTE>:<PATH>
```

### Retention Policy

- **Local**: 7 days (configurable via `RETAIN_LOCAL_DAYS`)
- **Remote**: 30 days (configurable via `RETAIN_REMOTE_DAYS`)
- **Tiered strategy**: daily/weekly/fortnightly/monthly slots

---

## Google Drive Backup Setup

### Configure rclone Remote

```bash
# Start interactive rclone config
docker compose --profile backup run --rm rclone config

# Follow prompts:
# n) New remote
# name> gdrive
# Storage> drive
# client_id> (leave empty or use your own)
# client_secret> (leave empty or use your own)
# scope> 1 (Full access)
# root_folder_id> (leave empty)
# service_account_file> (leave empty)
# Advanced config? n
# Auto config? n (for headless servers)
#
# rclone will show a URL - open on your desktop, authorize, copy token back

# Test the remote
docker compose --profile backup run --rm rclone lsd gdrive:

# Create backup directory
docker compose --profile backup run --rm rclone mkdir gdrive:ZenOpsBackups
```

### Update .env

```bash
# Add to .env or .env.backend
RCLONE_REMOTE=gdrive:ZenOpsBackups/production
```

### Test Upload

```bash
echo "test" > /tmp/test.txt
docker compose --profile backup run --rm rclone \
  copy /tmp/test.txt gdrive:ZenOpsBackups/test/

docker compose --profile backup run --rm rclone \
  lsf gdrive:ZenOpsBackups/test/
```

### Encrypted Backups (Optional)

```bash
# Configure crypt remote wrapping gdrive
docker compose --profile backup run --rm rclone config

# n) New remote
# name> gdrive-crypt
# Storage> crypt
# remote> gdrive:ZenOpsBackups/encrypted
# filename_encryption> standard
# directory_name_encryption> true
# password> <strong password>
# password2> <salt password>

# Update .env
RCLONE_REMOTE=gdrive-crypt:
```

---

## Database Migrations

### Run Migrations Standalone

```bash
./ops/migrate.sh
```

### Check Migration Status

```bash
docker compose run --rm migrate alembic current
docker compose run --rm migrate alembic history
```

### Create New Migration

```bash
docker compose run --rm api alembic revision -m "description"
# Edit the generated file in backend/alembic/versions/
```

---

## Restore Procedures

### Monthly Restore Drill (TEST MODE)

```bash
# Find latest backup
LATEST=$(ls -t ./deploy/backups/*.dump | head -1)

# Restore to temporary database for testing
./ops/restore.sh MODE=test BACKUP_FILE="$LATEST"

# Cleanup after verification
docker rm -f <test-container-name>
docker volume rm <test-volume-name>
```

### Disaster Recovery (PRODUCTION RESTORE)

⚠️ **Only use in actual emergency**

```bash
# Step 1: Find backup file
ls -lah ./deploy/backups/*.dump | tail -10

# Step 2: Run restore (creates NEW volume, does not touch production)
./ops/restore.sh MODE=disaster BACKUP_FILE="./deploy/backups/zenops_YYYYMMDD_HHMMSS.dump" CONFIRM=YES

# Step 3: Follow manual instructions printed by script
# The script will NOT automatically swap volumes
# You must manually update docker-compose.yml and restart
```

### Disaster Recovery Steps

The `restore.sh MODE=disaster` script stops services and creates a new volume but requires manual completion:

1. Script creates: `postgres_data_restored_YYYYMMDD_HHMMSS`
2. You must edit `docker-compose.yml`:
   ```yaml
   volumes:
     postgres_data:
       external: true
       name: postgres_data_restored_20260208_140000  # Use actual name
   ```
3. Restart DB: `docker compose up -d db`
4. Verify: `docker compose exec db psql -U zenops -c '\dt'`
5. Start all: `docker compose up -d`

---

## Rollback Procedures

### Code Rollback

```bash
# View recent commits
git log --oneline -10

# Checkout previous version
git checkout <commit-hash>

# Redeploy
./ops/deploy.sh
```

### Database Rollback

If a migration breaks production:

```bash
# 1. Find pre-migration backup (created by deploy.sh)
ls -lah ./deploy/backups | grep $(date +%Y-%m-%d)

# 2. Restore using disaster mode
./ops/restore.sh MODE=disaster BACKUP_FILE="<backup>" CONFIRM=YES

# 3. Follow manual steps to swap volumes

# 4. Revert migrations (if needed)
docker compose run --rm migrate alembic downgrade -1
```

---

## Health Checks & Monitoring

### Verify Services

```bash
# All services status
docker compose ps

# API health
curl http://localhost/readyz

# Expected: {"status":"ok","alembic_revision":"..."}
```

### View Logs

```bash
# Real-time API logs
docker compose logs -f api

# Last 100 lines
docker compose logs --tail=100 api

# All services
docker compose logs -f
```

### Check Disk Usage

```bash
# Docker volumes
docker system df -v

# Backup directory
du -sh ./deploy/backups
```

---

## Smoke Test Checklist

After each deployment, verify:

- [ ] **Login**: Navigate to http://localhost, login as admin
- [ ] **Dashboard**: Home page loads, summary cards display
- [ ] **Assignments**: List loads, click an assignment
- [ ] **Assignment Detail**: All tabs load (Overview, Documents, Tasks, etc.)
- [ ] **Documents**: Upload a file, verify preview works
- [ ] **Master Data**: Navigate to Master Data > File Templates
- [ ] **Bank Templates**: Create template with bank selection
- [ ] **Payroll** (if applicable): View payroll runs, line items display
- [ ] **API Health**: `curl http://localhost/readyz` returns 200

---

## Troubleshooting

### API Won't Start

```bash
# Check logs
docker compose logs api

# Common issues:
# - DB not ready: wait 30s and retry
# - Migration failed: check migration logs
# - Port conflict: stop conflicting service
```

### Backup Fails

```bash
# Check backup service logs
docker compose --profile backup logs backup

# Test DB connection
docker compose exec db pg_isready -U zenops

# Verify backup directory writable
ls -la ./deploy/backups
```

### Frontend Shows Old Version

```bash
# Hard refresh browser: Ctrl+Shift+R (or Cmd+Shift+R on Mac)

# Verify new image built
docker compose images frontend

# Force rebuild
docker compose build --no-cache frontend
docker compose up -d frontend
```

### Restore Fails

```bash
# Verify backup file integrity
file ./deploy/backups/zenops_*.dump

# Should show: "PostgreSQL custom database dump"

# Check file size (should be > 1MB for real data)
ls -lh ./deploy/backups/zenops_*.dump
```

---

## Scheduled Maintenance Windows

### Monthly Tasks

- [ ] Run restore drill (`MODE=test`)
- [ ] Verify backups exist and are non-empty
- [ ] Check disk space (`docker system df`)
- [ ] Review logs for errors
- [ ] Update dependencies (if security patches)

### Quarterly Tasks

- [ ] Review and update environment variables
- [ ] Rotate secrets (database password, encryption keys)
- [ ] Test disaster recovery procedure (staging environment)
- [ ] Audit backup retention policy

---

## Emergency Contacts & Escalation

_Document your team's contact information here_

- **Primary On-Call**: 
- **Database Admin**:
- **Infrastructure Lead**:
- **Backup Contact**:

---

## Reference Commands

```bash
# Quick reference of all ops scripts

./ops/deploy.sh                      # Full deployment
./ops/backup_now.sh                  # One-shot backup
./ops/migrate.sh                     # Run migrations only
./ops/enable_scheduled_backups.sh    # Start backup-cron
./ops/disable_scheduled_backups.sh   # Stop backup-cron
./ops/restore.sh                     # Restore database

# Environment variables for deploy.sh
PULL=1           # Git pull before deploy
CONFIRM=YES      # Proceed with dirty working directory
HEALTH_TIMEOUT=60  # Health check timeout in seconds

# Environment variables for restore.sh
MODE=test        # Test restore (default)
MODE=disaster    # Production restore (requires CONFIRM=YES)
BACKUP_FILE=<path>  # Path to .dump file
```

---

## Appendix: Directory Structure

```
/opt/zen-ops/
├── docker-compose.yml          # Main compose file
├── .env                         # Main environment vars
├── .env.backend                 # Backend environment vars
├── ops/                         # Operations scripts
│   ├── deploy.sh
│   ├── backup_now.sh
│   ├── migrate.sh
│   ├── enable_scheduled_backups.sh
│   ├── disable_scheduled_backups.sh
│   └── restore.sh
├── deploy/
│   ├── backups/                 # Local backup storage
│   ├── rclone/                  # rclone config persistence
│   ├── backup/                  # Backup scripts & Dockerfiles
│   │   ├── backup.sh
│   │   ├── restore.sh
│   │   ├── Dockerfile
│   │   ├── cron.Dockerfile
│   │   ├── crontab
│   │   └── dispatcher.sh
│   └── caddy/                   # Reverse proxy config
├── backend/                     # FastAPI application
└── frontend/                    # React application
```

---

**Last Updated**: 2026-02-08  
**Protocol Version**: v1.0
