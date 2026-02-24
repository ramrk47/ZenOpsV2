# Zen Ops Support System Runbook

## Overview
This runbook provides procedures for monitoring, troubleshooting, and maintaining the Zen Ops support system (email delivery, support threads, WhatsApp integration).

## Table of Contents
1. [Health Monitoring](#health-monitoring)
2. [Log Locations](#log-locations)
3. [Email Delivery Issues](#email-delivery-issues)
4. [Support Portal Token Issues](#support-portal-token-issues)
5. [Database Issues](#database-issues)
6. [Client Error Monitoring](#client-error-monitoring)
7. [Monthly Restore Drill](#monthly-restore-drill)

---

## Health Monitoring

### Quick Health Check
```bash
# Check all health endpoints
curl http://localhost/healthz | jq .
curl http://localhost/readyz | jq .
curl http://localhost/version | jq .
```

### Expected Responses

**`/healthz` - Health Status**
```json
{
  "status": "ok",
  "database": "ok",
  "email_queue_pending": 5,
  "email_queue_failed": 0
}
```
- `status: "degraded"` = Warning, system functional but slow
- `status: "ok"` = All systems nominal
- HTTP 503 = Service unavailable, check logs

**Thresholds:**
- Degraded if `email_queue_pending > 100`
- Degraded if `email_queue_failed > 50`

**`/readyz` - Readiness**
```json
{
  "status": "ok",
  "alembic_revision": "0032_abc123"
}
```
- HTTP 503 = DB unavailable or migrations not applied

### Automated Monitoring

Add to your monitoring system:
```bash
# Check every 60 seconds
*/1 * * * * curl -f http://localhost/healthz || alert
```

---

## Log Locations

### Container Logs
```bash
# API server logs (JSON structured)
docker logs zen-ops-api-1 --tail 100 --follow

# Email worker logs
docker logs zen-ops-email-worker-1 --tail 100 --follow

# All zen-ops containers
docker logs --tail 100 $(docker ps -q --filter "name=zen-ops")
```

### Log Format
All logs are JSON with these fields:
```json
{
  "timestamp": "2026-02-09T17:00:00Z",
  "level": "ERROR",
  "logger": "request",
  "message": "...",
  "request_id": "uuid",
  "user_id": 123,
  "path": "/api/...",
  "method": "POST"
}
```

### Useful Log Queries
```bash
# Find all errors in last hour
docker logs zen-ops-api-1 --since 1h 2>&1 | jq 'select(.level=="ERROR")'

# Find specific request
docker logs zen-ops-api-1 2>&1 | jq 'select(.request_id=="abc-123")'

# Email delivery failures
docker logs zen-ops-email-worker-1 2>&1 | jq 'select(.message | contains("email_delivery_failed"))'

# Client-side errors
docker logs zen-ops-api-1 2>&1 | jq 'select(.message=="client_error")'
```

---

## Email Delivery Issues

### Problem: Emails Not Sending

**1. Check email queue status**
```bash
docker exec zen-ops-db-1 psql -U zenops -d zenops -c "
    SELECT status, COUNT(*) as count, MAX(created_at) as latest
    FROM email_delivery_logs 
    GROUP BY status;
"
```

**2. Check worker is running**
```bash
docker ps --filter "name=email-worker"
docker logs zen-ops-email-worker-1 --tail 50
```

**3. Check for failures**
```sql
-- Failed emails (5+ retries)
SELECT id, event_type, to_email, last_error, attempts, created_at
FROM email_delivery_logs
WHERE status = 'FAILED' AND attempts >= 5
ORDER BY created_at DESC
LIMIT 20;
```

**4. Check Resend API key**
```bash
# Verify environment variable is set
docker exec zen-ops-api-1 env | grep EMAIL

# Should show:
# EMAIL_PROVIDER=resend
# EMAIL_API_KEY=re_***
# EMAIL_FROM=noreply@zenops.com
```

### Problem: Queued Emails Stuck

**Symptoms:** Large `email_queue_pending` count

**Solution 1: Restart Email Worker**
```bash
docker compose restart email-worker
docker logs zen-ops-email-worker-1 --tail 50 --follow
```

**Solution 2: Check for dead workers**
```bash
# Worker should log heartbeat every 60s
docker logs zen-ops-email-worker-1 --tail 100 | grep "processing\|idle"
```

**Solution 3: Manually retry failed emails**
```sql
-- Reset failed emails for retry (use with caution)
UPDATE email_delivery_logs
SET status = 'QUEUED', attempts = 0, last_error = NULL
WHERE status = 'FAILED' 
  AND attempts < 3
  AND created_at > NOW() - INTERVAL '1 day';
```

### Problem: Duplicate Emails

**Cause:** Idempotency key collision or worker restart

**Check for duplicates:**
```sql
SELECT idempotency_key, COUNT(*) as count
FROM email_delivery_logs
GROUP BY idempotency_key
HAVING COUNT(*) > 1;
```

**Prevention:** System already uses idempotency keys. If duplicates occur, check:
1. Worker crashed mid-send
2. Idempotency key generation logic

---

## Support Portal Token Issues

### Problem: External User Can't Access Thread

**1. Verify token exists and is valid**
```sql
SELECT id, token_hash, assignment_id, thread_id, 
       expires_at, revoked_at, is_revoked, use_count
FROM support_tokens
WHERE id = <token_id>;
```

**2. Check token expiry**
- Default expiry: 7 days
- Expired tokens cannot be used
- Generate new token if expired

**3. Check token scope**
```sql
-- Token must match thread/assignment
SELECT t.id, t.assignment_id, t.thread_id, 
       a.assignment_reference, th.subject
FROM support_tokens t
LEFT JOIN assignments a ON t.assignment_id = a.id
LEFT JOIN support_threads th ON t.thread_id = th.id
WHERE t.id = <token_id>;
```

**4. Generate new token (via API)**
```bash
# Admin only
curl -X POST http://localhost/api/support/tokens \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"assignment_id": 123, "expiry_days": 7}'
```

### Problem: Token Verification Fails

**Logs show:** `"Invalid or expired support token"`

**Possible causes:**
1. Token expired (`expires_at < now()`)
2. Token revoked (`is_revoked = true`)
3. Wrong token string (hash doesn't match)
4. Token deleted from DB

**Fix:**
- Check logs for `token_verification_failed` events
- Generate new token for user
- Verify token format (should be 64-char hex string)

---

## Database Issues

### Problem: Support Queries Slow

**1. Check for missing indexes**
```sql
-- These indexes should exist
\d support_threads
\d support_messages
\d email_delivery_logs
```

**2. Check table sizes**
```sql
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE tablename LIKE 'support_%' OR tablename = 'email_delivery_logs'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

**3. Vacuum if needed**
```bash
docker exec zen-ops-db-1 psql -U zenops -d zenops -c "VACUUM ANALYZE support_threads;"
docker exec zen-ops-db-1 psql -U zenops -d zenops -c "VACUUM ANALYZE email_delivery_logs;"
```

### Problem: Email Logs Growing Too Large

**Archive old email logs** (older than 90 days):
```sql
-- 1. Export to backup
COPY (
    SELECT * FROM email_delivery_logs 
    WHERE created_at < NOW() - INTERVAL '90 days'
) TO '/tmp/email_logs_archive.csv' CSV HEADER;

-- 2. Delete from table
DELETE FROM email_delivery_logs
WHERE created_at < NOW() - INTERVAL '90 days';

-- 3. Vacuum
VACUUM ANALYZE email_delivery_logs;
```

---

## Client Error Monitoring

### Viewing Client-Side Errors

**1. Check API logs for client errors**
```bash
docker logs zen-ops-api-1 2>&1 | jq 'select(.message=="client_error")' | jq -s '.'
```

**2. Common client errors**
```bash
# Group by component
docker logs zen-ops-api-1 2>&1 | \
  jq -r 'select(.message=="client_error") | .component' | \
  sort | uniq -c | sort -rn

# Group by route
docker logs zen-ops-api-1 2>&1 | \
  jq -r 'select(.message=="client_error") | .route' | \
  sort | uniq -c | sort -rn
```

**3. Specific error details**
```bash
# Show last 10 client errors with stack traces
docker logs zen-ops-api-1 2>&1 | \
  jq 'select(.message=="client_error") | {timestamp, route, message: .extra.message, stack: .extra.stack}' | \
  tail -10
```

---

## Monthly Restore Drill

### Purpose
Verify backups are valid and restore process works.

### Procedure (20 minutes)

**1. List available backups**
```bash
ls -lh deploy/backups/
```

**2. Run restore test**
```bash
./ops/diagnostics.sh
./ops/restore_test.sh
```

**3. Verify restored data**
```bash
# Connect to restore DB
docker exec -it zen-ops-restore-db psql -U zenops -d zenops_restore

# Check critical tables
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM assignments;
SELECT COUNT(*) FROM support_threads;
SELECT version_num FROM alembic_version;
```

**4. Cleanup test DB**
```bash
docker compose down zen-ops-restore-db
docker volume rm postgres_data_restore_<timestamp>
```

**5. Document results**
- Backup file used
- Restore duration
- Data verification results
- Any issues encountered

### If Restore Fails

**Check:**
1. Backup file corruption: `pg_restore --list <file>`
2. PostgreSQL version mismatch
3. Disk space: `df -h`
4. Logs: `docker logs zen-ops-restore-db`

---

## Troubleshooting Quick Reference

| Symptom | Likely Cause | Quick Fix |
|---------|--------------|-----------|
| No emails sending | Worker stopped | `docker compose restart email-worker` |
| Emails stuck in queue | Worker overloaded | Check `email_queue_pending` count |
| 503 on /healthz | DB connection failed | `docker compose restart db api` |
| Token invalid | Expired or revoked | Generate new token |
| Client errors spiking | JS bundle issue | Check frontend build |
| Slow queries | Missing indexes | Check migration 0032 applied |
| High disk usage | Email logs too large | Archive old logs (see above) |

---

## Emergency Contacts

- **On-call Engineer:** [Slack channel or phone]
- **Database Admin:** [Contact info]
- **DevOps Team:** [Contact info]

---

## Related Documentation

- [DEPLOYMENT_READY.md](../DEPLOYMENT_READY.md) - Deployment procedures
- [RESTORE_RUNBOOK.md](./RESTORE_RUNBOOK.md) - Detailed restore procedures
- [SUPPORT_EMAIL_WHATSAPP_SPEC.md](../SUPPORT_EMAIL_WHATSAPP_SPEC.md) - Technical specification
- [PHASE3_COMPLETE.md](../PHASE3_COMPLETE.md) - API endpoints reference
- [PHASE4_SUMMARY.md](../PHASE4_SUMMARY.md) - Frontend components reference

---

## Version History

| Date | Version | Changes |
|------|---------|---------|
| 2026-02-09 | 1.0 | Initial runbook for support system |
