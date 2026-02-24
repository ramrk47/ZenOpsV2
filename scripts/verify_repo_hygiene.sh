#!/usr/bin/env bash
set -euo pipefail

status=0

tracked_env=$(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '\.example$' || true)
tracked_venv=$(git ls-files | grep -E '(^|/)backend/\.venv(/|$)' || true)
tracked_node=$(git ls-files | grep -E '(^|/)frontend/node_modules(/|$)' || true)

if [ -n "$tracked_env" ]; then
  echo "FAIL: tracked .env files found."
  echo "$tracked_env"
  echo "How to fix: git rm --cached .env .env.*"
  status=1
fi

if [ -n "$tracked_venv" ]; then
  echo "FAIL: tracked backend/.venv found."
  echo "$tracked_venv"
  echo "How to fix: git rm --cached -r backend/.venv"
  status=1
fi

if [ -n "$tracked_node" ]; then
  echo "FAIL: tracked frontend/node_modules found."
  echo "$tracked_node"
  echo "How to fix: git rm --cached -r frontend/node_modules"
  status=1
fi

if [ "$status" -ne 0 ]; then
  exit 1
fi

echo "PASS: repo hygiene checks OK."
