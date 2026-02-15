#!/usr/bin/env bash

# shellcheck disable=SC2034
ZENOPS_V2_API_BASE_SOURCE="${ZENOPS_V2_API_BASE_SOURCE:-}"

_json_field() {
  local json="$1"
  local field="$2"
  printf '%s' "$json" | node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const value = data[process.argv[1]];
if (value === undefined || value === null) process.exit(2);
process.stdout.write(String(value));
' "$field" 2>/dev/null
}

_probe_v2_meta() {
  local base_url="$1"
  local response
  response="$(curl -sS -m 2 -H 'accept: application/json' -w $'\n%{http_code}\n%{content_type}' "${base_url}/meta" 2>/dev/null || true)"

  local content_type="${response##*$'\n'}"
  local rest="${response%$'\n'*}"
  local status="${rest##*$'\n'}"
  local body="${rest%$'\n'*}"

  if [[ -z "$status" ]]; then
    return 1
  fi

  if [[ "$status" -lt 200 || "$status" -gt 299 ]]; then
    return 1
  fi

  if [[ "$content_type" == text/html* ]] || [[ "$body" == \<\!* ]]; then
    return 1
  fi

  local app
  app="$(_json_field "$body" "app" || true)"
  if [[ "$app" != "zenops-v2" ]]; then
    return 1
  fi

  local repo_root
  repo_root="$(_json_field "$body" "repo_root" || true)"
  if [[ -n "$repo_root" ]]; then
    export ZENOPS_V2_RESOLVED_REPO_ROOT="$repo_root"
  fi

  return 0
}

_candidate_ports() {
  local seen=" "
  local port

  if command -v lsof >/dev/null 2>&1; then
    while IFS= read -r port; do
      [[ -z "$port" ]] && continue
      if [[ "$seen" != *" ${port} "* ]]; then
        printf '%s\n' "$port"
        seen="${seen}${port} "
      fi
    done < <(
      lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null \
        | awk 'NR>1 && ($1 ~ /node|python|uvicorn|gunicorn/) {
            split($9, parts, ":");
            print parts[length(parts)];
          }' \
        | sort -n
    )
  fi

  for port in 3000 3001 3002 3003 3004 3005 3006 3007 3008 3009 3010 3300 8000; do
    if [[ "$seen" != *" ${port} "* ]]; then
      printf '%s\n' "$port"
      seen="${seen}${port} "
    fi
  done
}

autodetect_v2_api_base() {
  local port
  local candidate
  while IFS= read -r port; do
    candidate="http://127.0.0.1:${port}/v1"
    if _probe_v2_meta "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done < <(_candidate_ports)
  return 1
}

resolve_v2_api_base() {
  local mode="${1:-can-start}"
  local explicit=""
  local default_base="http://127.0.0.1:${API_PORT:-3000}/v1"
  local detected=""

  if [[ -n "${ZENOPS_V2_API_BASE_URL:-}" ]]; then
    explicit="$ZENOPS_V2_API_BASE_URL"
  elif [[ -n "${API_BASE_URL:-}" ]]; then
    explicit="$API_BASE_URL"
  fi

  if [[ -n "$explicit" ]]; then
    if ! _probe_v2_meta "$explicit"; then
      echo "ERROR: API base URL does not point to ZenOps V2: ${explicit}" >&2
      return 1
    fi
    ZENOPS_V2_API_BASE_SOURCE="explicit"
    printf '%s\n' "$explicit"
    return 0
  fi

  if _probe_v2_meta "$default_base"; then
    ZENOPS_V2_API_BASE_SOURCE="default"
    printf '%s\n' "$default_base"
    return 0
  fi

  detected="$(autodetect_v2_api_base || true)"
  if [[ -n "$detected" ]]; then
    ZENOPS_V2_API_BASE_SOURCE="detected"
    printf '%s\n' "$detected"
    return 0
  fi

  if [[ "$mode" == "must-exist" ]]; then
    echo "ERROR: no running ZenOps V2 API found. Set ZENOPS_V2_API_BASE_URL explicitly." >&2
    return 1
  fi

  ZENOPS_V2_API_BASE_SOURCE="default"
  printf '%s\n' "$default_base"
}

apply_v2_api_base() {
  local mode="${1:-can-start}"
  local resolved
  resolved="$(resolve_v2_api_base "$mode")" || return 1

  export API_BASE_URL="$resolved"
  export ZENOPS_V2_API_BASE_URL="$resolved"
  export ZENOPS_V2_API_BASE_SOURCE

  if [[ "$resolved" =~ ^http://127\.0\.0\.1:([0-9]+)/v1$ ]]; then
    export API_PORT="${BASH_REMATCH[1]}"
  fi
}
