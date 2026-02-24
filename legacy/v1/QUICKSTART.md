# Zen Ops Production Protocol - Quick Start

## 🚀 One-Time VPS Setup

```bash
# Clone repo
git clone <repo-url> /opt/zen-ops
cd /opt/zen-ops

# Configure environment
cp .env.example .env
cp backend/.env.example .env.backend
nano .env.backend  # Set passwords, email config

# Initial deploy
./ops/deploy.sh

# Enable nightly backups
./ops/enable_scheduled_backups.sh
```

---

## 📦 Standard Deployment

```bash
cd /opt/zen-ops
./ops/deploy.sh
```

Includes: **backup → migrate → build → health check**

---

## 💾 Backup Operations

```bash
# Manual backup
./ops/backup_now.sh

# Enable/disable scheduled backups
./ops/enable_scheduled_backups.sh
./ops/disable_scheduled_backups.sh

# View backups
ls -lah ./deploy/backups | tail -10
```

---

## 🔄 Database Operations

```bash
# Run migrations only
./ops/migrate.sh

# Test restore (safe)
./ops/restore.sh MODE=test BACKUP_FILE="./deploy/backups/zenops_*.dump"

# Disaster recovery (requires CONFIRM=YES)
./ops/restore.sh MODE=disaster BACKUP_FILE="<file>" CONFIRM=YES
```

---

## 🏥 Health & Verification

```bash
# API health
curl http://localhost/readyz

# Service status
docker compose ps

# Logs
docker compose logs -f api
docker compose logs -f frontend
```

---

## 🔙 Rollback

```bash
# Code rollback
git checkout <previous-commit>
./ops/deploy.sh

# Database rollback
ls -lah ./deploy/backups | tail -10  # Find backup
./ops/restore.sh MODE=disaster BACKUP_FILE="<file>" CONFIRM=YES
# Follow printed instructions to swap volumes
```

---

## 🔐 Google Drive Backup Setup

```bash
# Configure rclone
docker compose --profile backup run --rm rclone config

# Test
docker compose --profile backup run --rm rclone lsd gdrive:

# Set in .env
RCLONE_REMOTE=gdrive:ZenOpsBackups/production
```

---

## 📋 Smoke Test Checklist

After deployment:
- [ ] Login works
- [ ] Dashboard loads
- [ ] Assignments list loads
- [ ] Assignment detail loads
- [ ] Document upload/preview works
- [ ] Master Data loads
- [ ] Payroll works (if applicable)

---

## 🚨 Emergency Procedures

### Service Won't Start
```bash
docker compose logs <service>
docker compose restart <service>
```

### Disk Full
```bash
docker system prune -a
find ./deploy/backups -mtime +30 -delete
```

### Database Corruption
```bash
LATEST=$(ls -t ./deploy/backups/*.dump | head -1)
./ops/restore.sh MODE=disaster BACKUP_FILE="$LATEST" CONFIRM=YES
```

---

## 📚 Full Documentation

- **Comprehensive Guide**: `docs/DEPLOYMENT_RUNBOOK.md`
- **Implementation Details**: `PRODUCTION_PROTOCOL_V1.md`

---

## 🛡️ Golden Rules

1. ❌ **NEVER** run `docker compose down -v`
2. ✅ Always backup before migrations (deploy.sh does this)
3. ✅ Test restores monthly
4. ✅ Use ops/ scripts (they have safety checks)
5. ✅ Keep backups offsite (configure rclone)

---

**Protocol Version**: v1.0  
**Last Updated**: 2026-02-08
