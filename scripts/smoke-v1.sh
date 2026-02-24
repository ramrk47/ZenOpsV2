#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
V1_ROOT="${ROOT}/legacy/v1"

if [[ ! -d "${V1_ROOT}" ]]; then
  echo "ERROR: legacy/v1 not found. Import V1 subtree first." >&2
  exit 1
fi

echo "[smoke-v1] compose validation"
bash "${V1_ROOT}/scripts/docker-test.sh"

echo "[smoke-v1] backend smoke"
(
  cd "${V1_ROOT}"
  exec bash ./scripts/validate.sh
)
