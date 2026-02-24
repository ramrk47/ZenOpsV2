#!/bin/bash
# Smoke tests for Support System
# Run after deployment to verify system is working

set -euo pipefail

API_BASE="${API_BASE:-http://localhost}"
FAILURES=0

echo "=== Zen Ops Support System Smoke Tests ==="
echo "API Base: ${API_BASE}"
echo ""

# Test 1: Health check
echo "[1/6] Testing /healthz..."
HEALTH=$(curl -s "${API_BASE}/healthz" || echo "FAILED")
if echo "$HEALTH" | jq -e '.status' > /dev/null 2>&1; then
    STATUS=$(echo "$HEALTH" | jq -r '.status')
    QUEUE=$(echo "$HEALTH" | jq -r '.email_queue_pending')
    echo "  ✓ Health check passed (status: $STATUS, queue: $QUEUE)"
else
    echo "  ✗ Health check failed"
    ((FAILURES++))
fi

# Test 2: Readiness check
echo "[2/6] Testing /readyz..."
READY=$(curl -s "${API_BASE}/readyz" || echo "FAILED")
if echo "$READY" | jq -e '.status' > /dev/null 2>&1; then
    REVISION=$(echo "$READY" | jq -r '.alembic_revision')
    echo "  ✓ Readiness check passed (migration: $REVISION)"
else
    echo "  ✗ Readiness check failed"
    ((FAILURES++))
fi

# Test 3: Public config endpoint (no auth)
echo "[3/6] Testing /api/support/public/config..."
CONFIG=$(curl -s "${API_BASE}/api/support/public/config" || echo "FAILED")
if echo "$CONFIG" | jq -e '.whatsapp_number' > /dev/null 2>&1; then
    WHATSAPP=$(echo "$CONFIG" | jq -r '.whatsapp_number')
    BUBBLE=$(echo "$CONFIG" | jq -r '.support_bubble_enabled')
    echo "  ✓ Public config accessible (WhatsApp: $WHATSAPP, bubble: $BUBBLE)"
else
    echo "  ✗ Public config failed"
    ((FAILURES++))
fi

# Test 4: OpenAPI docs
echo "[4/6] Testing /docs..."
DOCS=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/docs" || echo "000")
if [ "$DOCS" = "200" ]; then
    echo "  ✓ OpenAPI docs accessible"
else
    echo "  ✗ OpenAPI docs failed (HTTP $DOCS)"
    ((FAILURES++))
fi

# Test 5: Client error logging (no auth)
echo "[5/6] Testing /api/client-logs..."
CLIENT_LOG=$(curl -s -X POST "${API_BASE}/api/client-logs" \
    -H "Content-Type: application/json" \
    -d '{"message":"Test smoke test error","severity":"info","route":"/test"}' \
    || echo "FAILED")
if echo "$CLIENT_LOG" | jq -e '.status' > /dev/null 2>&1; then
    echo "  ✓ Client error logging works"
else
    echo "  ✗ Client error logging failed"
    ((FAILURES++))
fi

# Test 6: Database connectivity (via healthz)
echo "[6/6] Testing database connectivity..."
DB_STATUS=$(echo "$HEALTH" | jq -r '.database' 2>/dev/null || echo "unknown")
if [ "$DB_STATUS" = "ok" ]; then
    echo "  ✓ Database connected"
else
    echo "  ✗ Database connection failed"
    ((FAILURES++))
fi

echo ""
echo "=== Results ==="
if [ $FAILURES -eq 0 ]; then
    echo "✅ All smoke tests passed!"
    exit 0
else
    echo "❌ $FAILURES test(s) failed"
    exit 1
fi
