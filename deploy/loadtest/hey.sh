#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"

echo "Running quick health check load test..."
hey -n 200 -c 25 "$BASE_URL/healthz"
