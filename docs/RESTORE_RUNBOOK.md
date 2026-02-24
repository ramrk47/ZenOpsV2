# Database Restore Runbook

This runbook covers database restore procedures for Zen Ops.

## Quick Reference

- **Test Restore** (safe): `./ops/restore.sh MODE=test BACKUP_FILE=<path>`
- **Disaster Recovery**: See [Disaster Recovery](#disaster-recovery) section
- **Monthly Drill**: See [Monthly Restore Drill](#monthly-restore-drill)

## Prerequisites

- Docker and docker compose installed
- Access to backup files (local or remote)
- Database credentials from `.env.backend`
- For encrypted backups: `BACKUP_ENCRYPTION_KEY` environment variable

## Backup Format

Backups are created in PostgreSQL custom format (`.dump`) or SQL format (`.sql.gz`):
- **Custom format**: `pg_dump -Fc` - recommended, supports parallel restore
- **SQL format**: `pg_dump | gzip` - plain text SQL, widely compatible

Location: `./deploy/backups/` (local) or remote (via rclone if configured)

## Test Restore (Safe)

**Purpose**: Verify backup integrity without affecting production.

**Steps**:

```bash
cd /path/to/zen-ops

# Find latest backup
ls -lh ./deploy/backups/*.dump

# Run test restore
MODE=test BACKUP_FILE=./deploy/backups/zenops_db_2026-02-09_14-30-00.dump ./ops/restore.sh
```

**What it does**:
1. Creates temporary database container and volume
2. Restores backup to temporary database
3. Verifies table count and schema
4. Prints connection instructions
5. Leaves test environment running for inspection

**Cleanup**:
```bash
# After inspection, cleanup test environment
docker rm -f zenops-restore-test-<pid>
docker volume rm zenops_restore_test_<timestamp>
```

## Disaster Recovery

⚠️ **WARNING**: Only use in actual disaster scenarios. Requires explicit confirmation.

### Prerequisites
1. Stop-the-world: All users must be logged out
2. Recent backup file verified via test restore
3. `CONFIRM=YES` environment variable must be set

### Procedure

```bash
cd /path/to/zen-ops

# 1. Set confirmation
export CONFIRM=YES
export MODE=disaster
export BACKUP_FILE=./deploy/backups/zenops_db_2026-02-09_14-30-00.dump

# 2. Run disaster restore
./ops/restore.sh

# 3. Follow on-screen instructions to complete recovery
```

**What it does**:
1. Stops api, email-worker, frontend services
2. Creates new database volume: `postgres_data_restored_<timestamp>`
3. Restores backup to new volume
4. Provides manual steps to swap volumes

### Manual Volume Swap Steps

After restore completes, follow printed instructions:

```bash
# 1. Backup current production volume (safety)
docker volume create postgres_data_backup_$(date +%Y%m%d)
docker run --rm -v postgres_data:/from -v postgres_data_backup_$(date +%Y%m%d):/to alpine sh -c 'cp -a /from/. /to'

# 2. Update docker-compose.yml
# Edit volumes section to use restored volume:
volumes:
  postgres_data:
    external: true
    name: postgres_data_restored_20260209_143000

# 3. Start database
docker compose up -d db

# 4. Verify database
docker compose exec db psql -U zenops -d zenops -c '\dt'

# 5. Start all services
docker compose up -d

# 6. Verify application
curl http://localhost/readyz
```

### Verification Checklist

After restore:
- [ ] Database connection successful
- [ ] Alembic version matches current migrations
- [ ] Admin user can log in
- [ ] Assignment list loads
- [ ] Document download works
- [ ] Notifications visible
- [ ] Check logs for errors

## Monthly Restore Drill

**Frequency**: Monthly (or after major upgrades)

**Purpose**: Ensure backups are restorable and team knows procedure.

### Drill Procedure

1. **Select Backup**:
   ```bash
   # List recent backups
   ls -lth ./deploy/backups/*.dump | head -5
   
   # Choose latest
   BACKUP_FILE=./deploy/backups/zenops_db_2026-02-09_14-30-00.dump
   ```

2. **Run Test Restore**:
   ```bash
   MODE=test BACKUP_FILE=$BACKUP_FILE ./ops/restore.sh
   ```

3. **Verify Schema**:
   ```bash
   # Connect to test DB
   docker exec -it zenops-restore-test-<pid> psql -U zenops -d zenops
   
   # Check key tables
   \dt
   SELECT COUNT(*) FROM users;
   SELECT COUNT(*) FROM assignments;
   SELECT COUNT(*) FROM assignment_documents;
   
   # Check alembic version
   SELECT * FROM alembic_version;
   ```

4. **Test Sample Queries**:
   ```sql
   -- Recent assignments
   SELECT id, assignment_code, status, created_at 
   FROM assignments 
   ORDER BY created_at DESC LIMIT 10;
   
   -- Active users
   SELECT id, email, role, is_active 
   FROM users 
   WHERE is_active = true LIMIT 10;
   
   -- Document stats
   SELECT COUNT(*), category 
   FROM assignment_documents 
   GROUP BY category;
   ```

5. **Record Results**:
   - Date of drill
   - Backup file tested
   - Time taken
   - Any issues encountered
   - Resolution steps

6. **Cleanup**:
   ```bash
   docker rm -f zenops-restore-test-<pid>
   docker volume rm zenops_restore_test_<timestamp>
   ```

### Drill Checklist Template

```markdown
## Restore Drill: [DATE]

**Backup File**: 
**Backup Date**: 
**Drill Start Time**: 
**Drill End Time**: 
**Duration**: 

### Results
- [ ] Restore completed successfully
- [ ] Table count verified
- [ ] Sample queries executed
- [ ] Schema version matches
- [ ] No major errors

### Issues Found
- [ ] None / [List any issues]

### Actions Required
- [ ] None / [List follow-up actions]

**Tested By**: 
**Signed Off**: 
```

## Troubleshooting

### Restore Fails: "relation already exists"

**Cause**: Database not empty

**Solution**:
```bash
# Drop and recreate database (test mode only)
docker exec zenops-restore-test-<pid> psql -U zenops -c "DROP DATABASE IF EXISTS zenops;"
docker exec zenops-restore-test-<pid> psql -U zenops -c "CREATE DATABASE zenops;"
```

### Restore Fails: "permission denied"

**Cause**: Ownership mismatch

**Solution**: Use `--no-owner --no-privileges` flags (already in restore script)

### Large Backup Takes Too Long

**Cause**: Large database or slow I/O

**Solutions**:
- Use custom format with parallel restore: `pg_restore -j 4`
- Restore to faster disk
- Consider incremental backups for very large DBs

### Encrypted Backup: "bad decrypt"

**Cause**: Wrong encryption key

**Solution**:
```bash
# Ensure correct key is set
export BACKUP_ENCRYPTION_KEY=<correct-key>
./ops/restore.sh MODE=test BACKUP_FILE=<encrypted-backup>
```

### Volume Already Exists

**Cause**: Previous test restore not cleaned up

**Solution**:
```bash
# List volumes
docker volume ls | grep restore

# Remove old test volumes
docker volume rm zenops_restore_test_<old-timestamp>
```

## Best Practices

1. **Test Monthly**: Schedule monthly restore drills
2. **Verify Immediately**: Test restores after creating backups
3. **Document Issues**: Record any problems in ops log
4. **Multiple Generations**: Keep daily, weekly, monthly backups
5. **Offsite Copies**: Use rclone to sync to remote storage
6. **Encryption**: Always encrypt remote backups
7. **Automate**: Schedule backup tests via cron or CI/CD

## Emergency Contacts

- Primary DBA: [TBD]
- Secondary DBA: [TBD]
- DevOps Lead: [TBD]
- Escalation: [TBD]

## Related Documentation

- [PRODUCTION_PROTOCOL_V1.md](../PRODUCTION_PROTOCOL_V1.md) - Deployment procedures
- [deploy/backup/README_backup.md](../deploy/backup/README_backup.md) - Backup system
- [SECURITY.md](../SECURITY.md) - Security best practices
