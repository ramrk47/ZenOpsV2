# Zen Ops Observability Stack

Production-grade monitoring, logging, and tracing for Zen Ops.

## Quick Start

```bash
# Start the observability stack alongside main services
docker compose --profile observability up -d

# View logs
docker compose --profile observability logs -f grafana

# Stop observability services only
docker compose --profile observability down
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           GRAFANA                                    │
│                    (Dashboards & Alerts UI)                         │
│                      http://localhost:3000                          │
└────────────────────────────┬────────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   PROMETHEUS    │ │      LOKI       │ │      TEMPO      │
│    (Metrics)    │ │     (Logs)      │ │    (Traces)     │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         GRAFANA ALLOY                                │
│              (Unified collector for logs, metrics, traces)          │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        APPLICATION SERVICES                          │
│  api │ frontend │ email-worker │ reverse-proxy │ db │ backups      │
└─────────────────────────────────────────────────────────────────────┘
```

## Components

### Metrics (Prometheus)

- **Prometheus** - Time-series database for metrics
- **Node Exporter** - Host/VM metrics (CPU, memory, disk, network)
- **cAdvisor** - Container metrics (per-container resource usage)
- **Postgres Exporter** - PostgreSQL metrics (connections, queries, locks)
- **Blackbox Exporter** - Synthetic HTTP probes

### Logs (Loki)

- **Loki** - Log aggregation and storage
- **Alloy** - Collects Docker container logs with labels

### Traces (Tempo)

- **Tempo** - Distributed tracing backend
- **Alloy** - Receives OTLP traces from API service

### Alerting

- **Alertmanager** - Alert routing and deduplication

### Monitoring Services

- **Watchdog** - API/Frontend contract monitor and smoke tests

## Accessing Grafana

1. Open http://localhost:3000 (or your configured domain)
2. Login with admin credentials (default: admin/admin, configure via env vars)
3. Explore pre-configured datasources and dashboards

### Default Credentials

| Service | Username | Password | Notes |
|---------|----------|----------|-------|
| Grafana | admin | admin | Set via `GRAFANA_ADMIN_PASSWORD` |

## Pre-configured Dashboards

1. **ZenOps - Container Metrics** - CPU, memory, network for all containers
2. **ZenOps - API Performance** - Request rates, latency percentiles, errors
3. **ZenOps - Database** - PostgreSQL connections, transactions, cache hit ratio

## Alert Rules

| Alert | Severity | Condition |
|-------|----------|-----------|
| ApiDown | critical | API /readyz unreachable for 1m |
| FrontendDown | critical | Frontend unreachable for 1m |
| ReverseProxyDown | critical | Reverse proxy unreachable for 1m |
| DatabaseDown | critical | PostgreSQL down for 1m |
| High5xxRate | warning | >5% of requests returning 5xx for 5m |
| HighLatencyP95 | warning | P95 latency >2s for 5m |
| HostDiskUsageHigh | warning | Disk usage >85% |
| HostDiskCritical | critical | Disk usage >95% |
| ContractMismatch | warning | Frontend calling missing API endpoints |
| SmokeTestFailed | warning | Watchdog smoke tests failing |

## Environment Variables

### Observability Services

| Variable | Default | Description |
|----------|---------|-------------|
| `GRAFANA_ADMIN_USER` | admin | Grafana admin username |
| `GRAFANA_ADMIN_PASSWORD` | admin | Grafana admin password |
| `GRAFANA_ROOT_URL` | http://localhost:3000 | External URL for Grafana |

### Backend Instrumentation

| Variable | Default | Description |
|----------|---------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | - | OTLP endpoint for traces (e.g., `http://alloy:4317`) |

### Watchdog Service

| Variable | Default | Description |
|----------|---------|-------------|
| `WATCHDOG_SMOKE_USER` | - | Username for authenticated smoke tests |
| `WATCHDOG_SMOKE_PASSWORD` | - | Password for authenticated smoke tests |
| `CHECK_INTERVAL` | 60 | Seconds between check cycles |

### Frontend Monitoring

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_SENTRY_DSN` | - | Sentry DSN for error tracking |
| `VITE_ENVIRONMENT` | development | Environment name for Sentry |
| `VITE_GIT_SHA` | - | Git SHA for release tagging |

## Runbook

### Viewing Logs

```bash
# In Grafana Explore, select Loki datasource
# Query: {container="api"} | json

# Filter by log level
{container="api"} | json | level="ERROR"

# Search for request ID
{container="api"} | json | request_id="abc-123"
```

### Viewing Traces

```bash
# In Grafana Explore, select Tempo datasource
# Search by service: service.name="zenops-api"
# Search by trace ID: trace_id="abc123"
```

### Viewing Metrics

```bash
# In Grafana Explore, select Prometheus datasource

# Container CPU usage
sum(rate(container_cpu_usage_seconds_total{name!=""}[5m])) by (name)

# Request rate by status
sum(rate(http_server_requests_total[5m])) by (status)

# P95 latency
histogram_quantile(0.95, sum(rate(http_server_request_duration_seconds_bucket[5m])) by (le))
```

### Debugging a Failing Deployment

1. **Check service health**: Open "ZenOps - Container Metrics" dashboard
2. **Check alerts**: Visit Alertmanager UI or Grafana Alerting
3. **Review logs**: Query Loki for errors in the failing service
4. **Check traces**: Look for failed spans in Tempo
5. **Verify endpoints**: Check Blackbox exporter targets in Prometheus

### Contract Mismatch Investigation

1. Query Loki: `{container="watchdog"} | json | level="ERROR"`
2. Check metric: `zenops_contract_missing_total` in Prometheus
3. Re-run endpoint extraction: `python observability/scripts/extract_frontend_endpoints.py`
4. Compare with OpenAPI: `curl http://localhost:8000/openapi.json`

## Updating Frontend Endpoints

When frontend API calls change, regenerate the endpoints file:

```bash
python observability/scripts/extract_frontend_endpoints.py

# Rebuild watchdog
docker compose --profile observability build watchdog
docker compose --profile observability up -d watchdog
```

## Security Notes

- Grafana, Prometheus, Loki, Tempo are **not exposed publicly** by default
- Access via localhost or internal Docker network only
- For production, expose Grafana through reverse proxy with authentication
- Never commit real Sentry DSN or alert webhook URLs to the repository

## Troubleshooting

### No metrics in Grafana

1. Check Prometheus targets: http://localhost:9090/targets
2. Verify services are running: `docker compose --profile observability ps`
3. Check Prometheus logs: `docker compose logs prometheus`

### No logs in Loki

1. Verify Alloy is running: `docker compose logs alloy`
2. Check Alloy can access Docker socket
3. Test Loki API: `curl http://localhost:3100/ready`

### No traces in Tempo

1. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set for API service
2. Check Alloy OTLP receiver: `docker compose logs alloy | grep otlp`
3. Verify Tempo is receiving: `docker compose logs tempo`

### Watchdog not detecting mismatches

1. Check frontend_endpoints.json is up to date
2. Verify API is accessible from watchdog container
3. Check watchdog logs: `docker compose logs watchdog`
