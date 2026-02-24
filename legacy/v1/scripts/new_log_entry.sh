#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="docs/AI_ENGINEERING_LOG.md"
DATE_VALUE=$(date +%F)
BRANCH_VALUE=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
AUTHOR_VALUE=${AUTHOR:-"AI tool (operator unknown)"}

read -r -d '' ENTRY <<EOF_TEMPLATE
Date (YYYY-MM-DD): ${DATE_VALUE}
Author (AI tool name + operator if known): ${AUTHOR_VALUE}
Branch name: ${BRANCH_VALUE}
Goal/Intent:
Changes summary (bullets):
- 
Files touched (explicit list):
- 
DB migrations (yes/no; if yes include revision id + what changed):
API contract changes (endpoints added/changed; include examples):
Frontend changes (routes/components; screenshots not required, but include what to click):
Tests/Validation run (exact commands + result):
Risks/Notes (edge cases, breaking risks):
Next steps (what to do next + recommended owner/tool):
Rollback notes (how to revert; commit hashes if applicable):
EOF_TEMPLATE

if [ "${1:-}" = "--stdout" ]; then
  printf "%s\n" "$ENTRY"
  exit 0
fi

if [ ! -f "$LOG_FILE" ]; then
  echo "Missing $LOG_FILE" >&2
  exit 1
fi

printf "\n%s\n" "$ENTRY" >> "$LOG_FILE"
echo "Appended log entry to $LOG_FILE"
