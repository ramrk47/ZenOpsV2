# Phase 5 Complete: Monitoring Layer

## Status: ✅ COMPLETE

All monitoring and observability features for the support system have been implemented.

## What Was Built

### 1. Enhanced Health Checks

**File:** `backend/app/main.py`

**Enhanced `/healthz` endpoint:**
- Database connectivity check
- Email queue backlog monitoring
- Failed email count tracking
- Status reporting: `ok`, `degraded`, or `503`

**Response:**
```json
{
  "status": "ok",
  "database": "ok",
  "email_queue_pending": 5,
  "email_queue_failed": 0
}
```

**Degradation Thresholds:**
- `status: "degraded"` if `email_queue_pending > 100`
- `status: "degraded"` if `email_queue_failed > 50`

### 2. Client Error Logging

**File:** `backend/app/routers/client_logs.py` (2.1 KB)

**New endpoint:** `POST /api/client-logs`
- No authentication required (errors can happen before auth)
- Accepts client-side JavaScript errors
- Logs to backend with structured format
- Includes request_id correlation

**Request Schema:**
```json
{
  "message": "Error message",
  "stack": "Stack trace",
  "route": "/page/path",
  "user_agent": "Browser info",
  "build_version": "1.0.0",
  "component": "ComponentName",
  "severity": "error",
  "metadata": {}
}
```

**Features:**
- Severity levels: error, warn, info
- Stack trace capture
- Route tracking
- User agent logging
- Build version tracking
- Request ID correlation

### 3. Enhanced ErrorBoundary

**File:** `frontend/src/components/ErrorBoundary.jsx`

**Improvements:**
- Automatically logs errors to backend via `/api/client-logs`
- Captures component stack traces
- Sends browser metadata
- Includes build version
- User-friendly error message: "Our team has been notified"
- Development mode shows full error details

**What Gets Logged:**
- Error message and stack trace
- Current route (window.location.pathname)
- User agent
- Build version (from VITE_BUILD_VERSION)
- Component that crashed
- Timestamp

### 4. Diagnostics Script

**File:** `ops/diagnostics.sh` (executable)

**Collects:**
1. Container status (all zen-ops containers)
2. Container logs (last 500 lines each)
3. Health endpoint responses (/healthz, /readyz, /version)
4. Database connection test
5. Email queue status
6. Support threads summary
7. Disk usage

**Usage:**
```bash
./ops/diagnostics.sh
```

**Output:**
- Creates `diagnostics_<timestamp>` directory
- Individual files for each component
- SUMMARY.txt with quick overview
- Tar archive option for support tickets

### 5. Comprehensive Runbook

**File:** `docs/SUPPORT_RUNBOOK.md` (10 KB)

**Sections:**
1. **Health Monitoring** - How to check system health
2. **Log Locations** - Where to find logs and how to query them
3. **Email Delivery Issues** - Troubleshooting stuck/failed emails
4. **Support Portal Token Issues** - Debugging token problems
5. **Database Issues** - Performance and maintenance
6. **Client Error Monitoring** - Viewing frontend errors
7. **Monthly Restore Drill** - Backup verification procedure

**Key Procedures:**
- "If emails aren't sending" step-by-step fix
- "If support tokens fail" debugging guide
- "How to replay queued emails" SQL commands
- "Monthly restore drill" 20-minute procedure
- Log query examples (JSON log parsing with jq)
- Emergency contact placeholders

## Architecture

### Structured Logging (Already in Place)
Zen Ops already had excellent structured logging:
- JSON format with request_id correlation
- User ID tracking from JWT tokens
- Path, method, status code, latency
- Exception handling with stack traces

**We built on this foundation by adding:**
- Client-side error logging
- Health check metrics
- Email queue monitoring

### Monitoring Flow

```
Frontend Error
    ↓
ErrorBoundary.componentDidCatch()
    ↓
POST /api/client-logs (no auth)
    ↓
Backend logs to stdout (JSON)
    ↓
Docker logs (viewable via docker logs)
    ↓
Optional: Forward to log aggregation (future)
```

### Health Check Flow

```
Load Balancer/Monitor
    ↓
GET /healthz every 60s
    ↓
Check DB + Email Queue
    ↓
Return status + metrics
    ↓
Alert if degraded/503
```

## Testing Phase 5

### 1. Test Enhanced Health Check
```bash
curl http://localhost/healthz | jq .

# Expected:
# {
#   "status": "ok",
#   "database": "ok",
#   "email_queue_pending": 0,
#   "email_queue_failed": 0
# }
```

### 2. Test Client Error Logging
```bash
curl -X POST http://localhost/api/client-logs \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Test client error",
    "stack": "Error: test\n  at Component.jsx:10",
    "route": "/test",
    "severity": "error"
  }'

# Then check logs:
docker logs zen-ops-api-1 --tail 20 | jq 'select(.message=="client_error")'
```

### 3. Test Frontend ErrorBoundary
In browser console:
```javascript
// This will trigger ErrorBoundary and send log to backend
throw new Error("Test error boundary")
```

Then check:
```bash
docker logs zen-ops-api-1 --tail 50 | grep client_error
```

### 4. Run Diagnostics
```bash
cd /path/to/zen-ops
./ops/diagnostics.sh

# Review output:
ls -lh diagnostics_*/
cat diagnostics_*/SUMMARY.txt
```

## Integration with Existing Systems

### Works With:
- ✅ Existing structured logging (RequestLoggingMiddleware)
- ✅ JWT authentication (optional for client logs)
- ✅ Docker Compose deployment
- ✅ Alembic migrations
- ✅ Email worker (notification_worker)

### No Changes Needed To:
- Database schema (no new tables)
- Docker Compose files
- Nginx/proxy config
- Environment variables

### Optional Enhancements (Future):
- Forward logs to ELK/Loki/Datadog
- Prometheus metrics endpoint
- Grafana dashboards
- PagerDuty/OpsGenie integration
- Automated monthly restore drill

## Files Changed (6 files, +648 lines)

```
M  backend/app/main.py                    (enhanced healthz)
M  backend/app/routers/__init__.py        (add client_logs)
A  backend/app/routers/client_logs.py     (new endpoint)
M  frontend/src/components/ErrorBoundary.jsx (auto-logging)
A  ops/diagnostics.sh                     (diagnostic tool)
A  docs/SUPPORT_RUNBOOK.md                (operations guide)
```

## Commit

```
feat: Phase 5 - Monitoring layer (enhanced health checks, client error logging, diagnostics, runbook)
Commit: cb2d8ee
Files: +648 lines in 6 files
```

## What's Next

✅ Phase 1: Database models - DONE  
✅ Phase 2: Email integration - DONE  
✅ Phase 3: Backend API - DONE  
✅ Phase 4: Frontend UIs - DONE  
✅ Phase 5: Monitoring layer - DONE  
⏭️ **Phase 6: Tests & Documentation** - FINAL PHASE  

### Phase 6 Will Include:
- Backend integration tests (pytest)
- Frontend smoke tests (Playwright or Vitest)
- API endpoint tests
- Update DEPLOYMENT_READY.md
- Final deployment checklist

---

## Quick Reference

### Check Logs
```bash
# API errors
docker logs zen-ops-api-1 | jq 'select(.level=="ERROR")'

# Client errors
docker logs zen-ops-api-1 | jq 'select(.message=="client_error")'

# Email worker
docker logs zen-ops-email-worker-1 --tail 100
```

### Health Status
```bash
curl http://localhost/healthz | jq .
```

### Run Diagnostics
```bash
./ops/diagnostics.sh
```

### Read Runbook
```bash
cat docs/SUPPORT_RUNBOOK.md
```
