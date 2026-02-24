#!/usr/bin/env bash
set -euo pipefail

TS="$(date +%Y%m%d-%H%M%S)"
OUT="ops/diagnostics/$TS"
mkdir -p "$OUT"

echo "📦 Collecting diagnostics to: $OUT"

# Snapshot state
docker compose ps > "$OUT/compose_ps.txt" 2>&1 || true
docker info > "$OUT/docker_info.txt" 2>&1 || true

# Logs (last 2 hours, generous tail)
for SVC in api email-worker frontend reverse-proxy db grafana prometheus loki alloy watchdog; do
  echo "  → $SVC"
  docker compose logs --since=2h --tail=4000 "$SVC" > "$OUT/$SVC.log" 2>&1 || true
done

# Container health/inspect for key services
for SVC in api db email-worker; do
  CONTAINER_ID=$(docker compose ps -q "$SVC" 2>/dev/null || true)
  if [ -n "$CONTAINER_ID" ]; then
    docker inspect "$CONTAINER_ID" > "$OUT/$SVC.inspect.json" 2>&1 || true
  fi
done

# Quick error index (so the agent starts from signal)
grep -RInE "traceback|exception|error|failed|panic|fatal|denied|unauthorized|forbidden|not found| 401 | 403 | 404 | 500 |critical|crash" \
  "$OUT" --include="*.log" > "$OUT/error_index.txt" 2>/dev/null || true

# Count errors per file
echo "" >> "$OUT/error_index.txt"
echo "=== ERROR COUNTS BY SERVICE ===" >> "$OUT/error_index.txt"
for f in "$OUT"/*.log; do
  COUNT=$(grep -ciE "error|exception|failed|500|fatal|panic" "$f" 2>/dev/null || echo 0)
  echo "  $(basename "$f"): $COUNT errors" >> "$OUT/error_index.txt"
done

echo ""
echo "✅ Wrote diagnostics to: $OUT"
echo "Start here: $OUT/error_index.txt"
echo ""
echo "Files created:"
ls -la "$OUT"