#!/bin/bash
# Zen Ops Diagnostics Script
# Collects system health, logs, and queue status

set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DIAG_DIR="./diagnostics_${TIMESTAMP}"

echo "=== Zen Ops Diagnostics Collector ==="
echo "Timestamp: ${TIMESTAMP}"
echo "Output: ${DIAG_DIR}"
echo ""

mkdir -p "${DIAG_DIR}"

# Container status
echo "[1/7] Collecting container status..."
docker ps -a --filter "name=zen-ops" > "${DIAG_DIR}/containers.txt" 2>&1 || echo "Failed to get container status" > "${DIAG_DIR}/containers.txt"

# Container logs (last 500 lines)
echo "[2/7] Collecting container logs..."
for container in $(docker ps -q --filter "name=zen-ops"); do
    name=$(docker inspect --format='{{.Name}}' "$container" | sed 's/\///')
    echo "  - ${name}"
    docker logs --tail 500 "$container" > "${DIAG_DIR}/${name}.log" 2>&1 || echo "Failed to get logs" > "${DIAG_DIR}/${name}.log"
done

# Health checks
echo "[3/7] Checking health endpoints..."
{
    echo "=== /healthz ===" 
    curl -s http://localhost/healthz | jq . || echo "Failed"
    echo ""
    echo "=== /readyz ==="
    curl -s http://localhost/readyz | jq . || echo "Failed"
    echo ""
    echo "=== /version ==="
    curl -s http://localhost/version | jq . || echo "Failed"
} > "${DIAG_DIR}/health.txt" 2>&1

# Database connection
echo "[4/7] Checking database..."
docker exec zen-ops-db-1 psql -U zenops -d zenops -c "SELECT 'DB connection OK' as status, now() as timestamp;" > "${DIAG_DIR}/database.txt" 2>&1 || echo "Failed to connect to database" > "${DIAG_DIR}/database.txt"

# Email queue status
echo "[5/7] Checking email queue..."
docker exec zen-ops-db-1 psql -U zenops -d zenops -c "
    SELECT status, COUNT(*) as count 
    FROM email_delivery_logs 
    GROUP BY status 
    ORDER BY count DESC;
" > "${DIAG_DIR}/email_queue.txt" 2>&1 || echo "Failed to query email queue" > "${DIAG_DIR}/email_queue.txt"

# Support threads summary
echo "[6/7] Checking support threads..."
docker exec zen-ops-db-1 psql -U zenops -d zenops -c "
    SELECT status, priority, COUNT(*) as count 
    FROM support_threads 
    GROUP BY status, priority 
    ORDER BY status, priority;
" > "${DIAG_DIR}/support_threads.txt" 2>&1 || echo "Failed to query support threads" > "${DIAG_DIR}/support_threads.txt"

# Disk usage
echo "[7/7] Checking disk usage..."
df -h > "${DIAG_DIR}/disk.txt" 2>&1 || echo "Failed to get disk usage" > "${DIAG_DIR}/disk.txt"

# Create summary
{
    echo "=== Zen Ops Diagnostics Summary ==="
    echo "Generated: ${TIMESTAMP}"
    echo ""
    echo "### Container Status ###"
    docker ps -a --filter "name=zen-ops" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    echo "### Health Status ###"
    curl -s http://localhost/healthz 2>/dev/null | jq . || echo "Health check failed"
    echo ""
    echo "### Recent Errors (last 20) ###"
    docker logs --tail 20 zen-ops-api-1 2>&1 | grep -i "error\|exception\|failed" || echo "No recent errors"
} > "${DIAG_DIR}/SUMMARY.txt"

echo ""
echo "✅ Diagnostics collected in: ${DIAG_DIR}"
echo ""
echo "To view summary:"
echo "  cat ${DIAG_DIR}/SUMMARY.txt"
echo ""
echo "To create archive:"
echo "  tar -czf diagnostics_${TIMESTAMP}.tar.gz ${DIAG_DIR}"
