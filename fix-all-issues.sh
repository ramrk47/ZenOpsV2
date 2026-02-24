#!/bin/bash
set -e

echo "🔧 Fixing zen-ops issues..."
echo ""

cd /Users/dr.156/zen-ops

echo "1️⃣ Stopping containers..."
docker compose down

echo ""
echo "2️⃣ Rebuilding backend (fixing payroll 404s)..."
docker compose build --no-cache api

echo ""
echo "3️⃣ Rebuilding frontend (fixing table clickability)..."
docker compose build --no-cache frontend

echo ""
echo "4️⃣ Starting containers..."
docker compose up -d

echo ""
echo "5️⃣ Waiting for services to be healthy..."
sleep 10

echo ""
echo "6️⃣ Running verification tests..."
echo ""

echo "✅ Testing payroll stats endpoint..."
STATS_RESPONSE=$(curl -s http://localhost/api/payroll/stats 2>&1)
if echo "$STATS_RESPONSE" | grep -q "Not Found"; then
    echo "❌ FAILED: Still getting 404 on /api/payroll/stats"
    echo "Response: $STATS_RESPONSE"
else
    echo "✅ SUCCESS: Payroll stats endpoint responding"
fi

echo ""
echo "✅ Testing payroll runs endpoint..."
RUNS_RESPONSE=$(curl -s http://localhost/api/payroll/runs 2>&1)
if echo "$RUNS_RESPONSE" | grep -q "Not Found"; then
    echo "❌ FAILED: Still getting 404 on /api/payroll/runs"
else
    echo "✅ SUCCESS: Payroll runs endpoint responding"
fi

echo ""
echo "✅ Checking container prefix..."
docker compose exec api grep "prefix=" /app/app/routers/payroll.py | head -1

echo ""
echo "✅ Checking CSP headers..."
curl -s -I http://localhost | grep -i "content-security-policy"

echo ""
echo "📊 Container status:"
docker compose ps

echo ""
echo "🎉 Fix complete!"
echo ""
echo "📝 Next steps:"
echo "1. Open http://localhost/admin/payroll/runs in your browser"
echo "2. Open browser console (F12) - should see NO 404 errors"
echo "3. Check that fonts load correctly (Network tab)"
echo "4. Click the first row in the payroll table - should be clickable"
echo ""
echo "If issues persist, check logs:"
echo "  docker compose logs -f api"
echo "  docker compose logs -f frontend"
