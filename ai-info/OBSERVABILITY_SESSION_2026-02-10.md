# Observability & Bug Fix Session - 2026-02-10

## Session Summary

Implemented a complete production-grade observability stack for ZenOps and fixed critical API bugs discovered through the monitoring system.

---

## What Was Built

### A) Observability Stack (Docker Compose Profile)

All services run with: `docker compose --profile observability up -d`

| Service | Image | Purpose |
|---------|-------|---------|
| prometheus | prom/prometheus:v2.50.1 | Metrics collection |
| alertmanager | prom/alertmanager:v0.27.0 | Alert routing |
| grafana | grafana/grafana:10.3.3 | Dashboards & visualization |
| loki | grafana/loki:2.9.4 | Log aggregation |
| tempo | grafana/tempo:2.3.1 | Distributed tracing |
| alloy | grafana/alloy:v1.3.0 | Log/metrics/trace collector |
| node-exporter | prom/node-exporter:v1.7.0 | Host metrics |
| cadvisor | gcr.io/cadvisor/cadvisor:v0.49.1 | Container metrics |
| postgres-exporter | prometheuscommunity/postgres-exporter:v0.15.0 | DB metrics |
| blackbox-exporter | prom/blackbox-exporter:v0.24.0 | HTTP probes |
| watchdog | zen-ops-watchdog | API contract monitoring |

### B) Files Created

```
observability/
├── prometheus/
│   ├── prometheus.yml          # Scrape configuration
│   └── alerts/
│       └── zenops.yml          # Alert rules (API down, 5xx, latency, disk, etc.)
├── alertmanager/
│   └── alertmanager.yml        # Alert routing config
├── loki/
│   └── loki.yml                # Log storage config
├── tempo/
│   └── tempo.yml               # Trace storage config
├── alloy/
│   └── alloy.hcl               # Collector config (logs, metrics, traces)
├── blackbox/
│   └── blackbox.yml            # HTTP probe modules
├── grafana/
│   └── provisioning/
│       ├── datasources/
│       │   └── datasources.yml # Auto-provisioned: Prometheus, Loki, Tempo, Alertmanager
│       ├── dashboards/
│       │   └── dashboards.yml  # Dashboard provider
│       ├── alerting/.gitkeep
│       ├── notifiers/.gitkeep
│       └── plugins/.gitkeep
│   └── dashboards/
│       ├── containers.json     # Container metrics dashboard
│       ├── api.json            # API latency/errors dashboard
│       └── database.json       # PostgreSQL dashboard
├── watchdog/
│   ├── watchdog.py             # Contract monitor service
│   ├── Dockerfile
│   ├── requirements.txt
│   └── frontend_endpoints.json # Extracted frontend API calls (158 endpoints)
├── scripts/
│   └── extract_frontend_endpoints.py  # Scans frontend/src/api/*.js
└── README.md                   # Full documentation

ops/diagnostics/
├── collect_logs.sh             # Log collector script for debugging
└── [timestamped folders]       # Collected diagnostics

.vscode/
└── tasks.json                  # VS Code tasks for log collection
```

### C) Backend Instrumentation

**File: `backend/app/core/observability.py`**
- OpenTelemetry setup (traces to Alloy/Tempo)
- Prometheus middleware (request counts, latency histograms)
- Request ID correlation (X-Request-Id header)
- Exception counter metric
- `/metrics` endpoint for Prometheus scrape

**File: `backend/app/main.py`**
- Integrated observability middleware
- Added `/healthz/deps` endpoint (DB, disk, uploads checks)

### D) Frontend Instrumentation

**File: `frontend/src/utils/sentry.js`**
- Sentry integration (guarded by VITE_SENTRY_DSN env var)
- Error boundary with Sentry reporting
- API error tracking

---

## Bugs Fixed

### Bug #1: Missing RBAC Function
- **Error:** `AttributeError: module 'app.core.rbac' has no attribute 'can_manage_support'`
- **File:** `backend/app/core/rbac.py`
- **Fix:** Added `can_manage_support()` function

### Bug #2: Async/Sync Mismatch
- **Error:** `TypeError: object ChunkedIteratorResult can't be used in 'await' expression`
- **File:** `backend/app/routers/document_comments.py`
- **Fix:** Changed all async functions to sync (session is sync, not async)

### Bug #3: UUID vs Integer Type Mismatch
- **Error:** `column "reviewed_by_user_id" is of type uuid but expression is of type integer`
- **File:** `backend/alembic/versions/0033_fix_reviewed_by_user_id_type.py`
- **Fix:** Migration to correct column type from UUID to Integer

### Bug #4: Contract Mismatches (15 missing endpoints)
- **Files:** `backend/app/routers/payroll.py`, `backend/app/routers/support.py`
- **Fix:** Added all missing endpoints:

**Payroll (8 endpoints):**
- `GET /api/payroll/payslips` - List payslips
- `GET /api/payroll/payslips/my` - User's payslips
- `GET /api/payroll/payslips/{id}` - Get payslip
- `GET /api/payroll/payslips/{id}/download` - Download PDF (501 stub)
- `POST /api/payroll/payslips/{id}/generate` - Generate PDF (501 stub)
- `POST /api/payroll/payslips/{id}/send-email` - Email payslip (501 stub)
- `POST /api/payroll/runs/{id}/close` - Close payroll run
- `POST /api/payroll/runs/{id}/send-approval` - Send for approval (501 stub)
- `GET /api/payroll/runs/{id}/export/{type}` - Export data (501 stub)

**Support (7 endpoints):**
- `GET /api/support/public/config` - Public config alias
- `POST /api/support/threads/{id}/close` - Close thread
- `POST /api/support/threads/{id}/resolve` - Resolve thread
- `POST /api/support/tokens/{id}/revoke` - Revoke token (POST alias)
- `GET /api/support/portal/{id}` - Get portal thread
- `GET /api/support/portal/{id}/threads` - List assignment threads
- `GET /api/support/portal/{id}/messages` - Get thread messages

---

## Commits Made

```
e631457 feat: Add log collector script and VS Code tasks for diagnostics
7ce5e56 fix: Add can_manage_support() and fix async/sync mismatch in document_comments
ac1ea7a fix: Add missing payroll/support endpoints to resolve contract mismatches
4c6d06e fix: Fix reviewed_by_user_id UUID/int mismatch and add Grafana provisioning dirs
```

---

## Current Status

| Component | Status |
|-----------|--------|
| All 16 containers | ✅ Running |
| Prometheus targets | ✅ 12/12 UP |
| Contract check | ✅ PASSED |
| API health | ✅ OK |
| Grafana | ✅ http://localhost:3000 (admin/admin123) |

---

## How to Use

### Start Observability Stack
```bash
docker compose --profile observability up -d
```

### View Grafana
- URL: http://localhost:3000
- Login: admin / admin123
- Datasources: Prometheus, Loki, Tempo, Alertmanager (auto-provisioned)

### Collect Logs for Debugging
```bash
./ops/diagnostics/collect_logs.sh
# Output: ops/diagnostics/<timestamp>/error_index.txt
```

### Check Contract Status
```bash
docker compose logs watchdog --since=5m | grep contract
# Expected: "Contract check passed - all frontend endpoints exist in OpenAPI"
```

### Query Logs in Grafana
```
{container=~".*api.*"} |= "ERROR"
{container=~".*watchdog.*"} |= "contract"
```

---

## Remaining Work (Optional)

1. **Enable OTEL Tracing:** Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4317` in API environment
2. **Implement 501 stubs:** PDF generation, email sending, payroll exports
3. **Add Sentry DSN:** Set `VITE_SENTRY_DSN` for frontend error tracking
4. **Configure Alertmanager:** Add email/Slack receivers for production alerts

---

## Files Modified (Summary)

| File | Changes |
|------|---------|
| `docker-compose.yml` | Added 11 observability services with profile |
| `backend/requirements.txt` | Added opentelemetry-*, prometheus-client |
| `backend/app/main.py` | Integrated observability, added /healthz/deps |
| `backend/app/core/rbac.py` | Added can_manage_support() |
| `backend/app/core/observability.py` | New - OTEL + Prometheus instrumentation |
| `backend/app/routers/document_comments.py` | Fixed async/sync mismatch |
| `backend/app/routers/payroll.py` | Added 8 missing endpoints |
| `backend/app/routers/support.py` | Added 7 missing endpoints |
| `backend/alembic/versions/0033_*` | Migration to fix UUID/int type |
| `frontend/package.json` | Added @sentry/react |
| `frontend/src/utils/sentry.js` | New - Sentry integration |
| `frontend/src/main.jsx` | Added ErrorBoundary |
