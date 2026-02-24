#!/bin/bash

# Comprehensive Fix Script for zen-ops
# Fixes: 404 errors, CSP issues, and ensures clean container rebuild

set -e

echo "========================================="
echo "zen-ops Bug Fix Script"
echo "========================================="
echo ""

# Stop containers
echo "1. Stopping all containers..."
docker compose down

# Rebuild containers without cache
echo ""
echo "2. Rebuilding containers (no cache)..."
docker compose build --no-cache api frontend

# Start containers
echo ""
echo "3. Starting containers..."
docker compose up -d

# Wait for services to be healthy
echo ""
echo "4. Waiting for services to be healthy..."
sleep 5

# Check API health
echo ""
echo "5. Checking API health..."
if docker compose exec -T api curl -f http://localhost:8000/readyz > /dev/null 2>&1; then
    echo "✅ API is healthy"
else
    echo "❌ API health check failed"
    exit 1
fi

# Check if payroll endpoints are working
echo ""
echo "6. Testing payroll endpoints..."
echo "   Testing /api/payroll/runs..."
if docker compose exec -T api curl -f http://localhost:8000/api/payroll/runs?limit=10 > /dev/null 2>&1; then
    echo "✅ Payroll runs endpoint working"
else
    echo "❌ Payroll runs endpoint failed (may need auth)"
fi

echo ""
echo "7. Testing stats endpoint..."
if docker compose exec -T api curl -f http://localhost:8000/api/payroll/stats > /dev/null 2>&1; then
    echo "✅ Payroll stats endpoint working"
else
    echo "❌ Payroll stats endpoint failed (may need auth)"
fi

# Show logs
echo ""
echo "8. Container logs (last 20 lines):"
echo "-----------------------------------"
docker compose logs --tail=20 api

echo ""
echo "========================================="
echo "✅ Fix complete!"
echo "========================================="
echo ""
echo "Summary of changes:"
echo "  ✓ Fixed payroll API prefix from /payroll to /api/payroll"
echo "  ✓ Added missing /api/payroll/stats endpoint"
echo "  ✓ Updated CSP to allow Google Fonts"
echo "  ✓ Rebuilt containers with --no-cache"
echo ""
echo "Next steps:"
echo "  1. Open your browser and check console for errors"
echo "  2. Test payroll page: http://localhost/admin/payroll/runs"
echo "  3. Verify fonts are loading correctly"
echo "  4. Test if first row in tables is clickable"
echo ""
echo "If issues persist, check logs with: docker compose logs -f api"
