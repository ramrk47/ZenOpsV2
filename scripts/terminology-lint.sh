#!/usr/bin/env bash
# Terminology Linter for ZenOps V2

set -euo pipefail

# Use grep to find deprecated terms
# We exclude TERMINOLOGY_CANONICAL.md because it defines the legacy mapping.
# We also exclude older changelogs and history docs.

FAIL=0

echo "🔍 Running Terminology Linter..."

# Function to check a specific term
check_term() {
  local term="$1"
  echo "Checking for deprecated term: '$term'"
  
  # grep -r: recursive, -i: case insensitive, -n: line numbers
  # We exclude the terminology doc itself
  # We exclude the linter script itself
  local matches=""
  
  if [ -f "scripts/terminology-lint.ignore" ]; then
    matches=$(grep -rin --exclude="TERMINOLOGY_CANONICAL.md" --exclude="terminology-lint.sh" --exclude-dir="history" "$term" apps/web/src apps/studio/src apps/portal/src docs 2>/dev/null | grep -v -F -f scripts/terminology-lint.ignore || true)
  else
    matches=$(grep -rin --exclude="TERMINOLOGY_CANONICAL.md" --exclude="terminology-lint.sh" --exclude-dir="history" "$term" apps/web/src apps/studio/src apps/portal/src docs 2>/dev/null || true)
  fi

  if [ -n "$matches" ]; then
    echo "❌ ERROR: Found deprecated term '$term':"
    echo "$matches"
    FAIL=1
  fi
}

check_term "Tenant #1"
check_term "Factory tenant"
check_term "Worker tenant"
check_term "Template Builder"

# For Partner, we might have some legitimate API bindings if we didn't rename the DB schema
# e.g. source_label = 'partner'. We will strict check 'partner' but maybe allow it if we only care about UI copy. 
# The user explicitly requested to fail on 'Partner'. We'll check it, with a word boundary to avoid partial matches if possible, but standard grep -i is fine.
# Note: we exclude App.tsx or API domains if they strictly require 'partner' for routing, but we've migrated the UI to 'referral_channel'.
check_term "\bPartner\b"

if [ $FAIL -ne 0 ]; then
  echo "💥 Terminology linter failed. Please update the above occurrences to canonical terms."
  exit 1
else
  echo "✅ Terminology linter passed! No deprecated terms found."
  exit 0
fi
