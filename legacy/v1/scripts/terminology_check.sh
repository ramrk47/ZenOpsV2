#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${1:-$ROOT_DIR/frontend/src}"

if ! command -v rg >/dev/null 2>&1; then
  echo "ripgrep (rg) is required for terminology_check.sh" >&2
  exit 2
fi

raw_matches="$(rg -n "['\"][^'\"]*(Partner|partner|Partners|partners)[^'\"]*['\"]" \
  "$TARGET_DIR" \
  --glob '*.js' \
  --glob '*.jsx' || true)"

if [[ -z "${raw_matches}" ]]; then
  echo "PASS: no partner terminology found."
  exit 0
fi

# Allow technical identifiers, routes, and API paths while flagging UI copy.
filtered_matches="$(printf '%s\n' "$raw_matches" | rg -v \
  "/api/partner|/partner|EXTERNAL_PARTNER|partner_id|maulya\\.partner\\.|key: 'partners'|activeTab === 'partners'|activeTab !== 'partners'|storedFilters\\.activeTab === 'partners'|import .*Partner|PartnerLayout|PartnerSidebar|PartnerRequestAccess|AdminPartnerDetail|AdminPartnerRequests|fetchExternalPartners|fetchPartner|updatePartner|createPartner|setPartner|partner\\.|\\(partner|partner\\)|toUserMessage\\(.*associate|label: 'Associates'|title=\\\"Associate|subtitle=\\\".*associate|help=\\\".*associate|placeholder=\\\".*associate" \
  || true)"

if [[ -n "${filtered_matches}" ]]; then
  echo "FAIL: non-allowlisted partner terminology found in frontend UI copy:"
  printf '%s\n' "$filtered_matches"
  exit 1
fi

echo "PASS: partner terminology only appears in technical identifiers/routes."
