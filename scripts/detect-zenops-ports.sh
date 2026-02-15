#!/usr/bin/env bash
set -euo pipefail

ALLOW_MULTIPLE_V2_APIS="${ALLOW_MULTIPLE_V2_APIS:-0}"

json_field() {
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

probe_meta() {
  local port="$1"
  local response
  response="$(curl -sS -m 2 -H 'accept: application/json' -w $'\n%{http_code}\n%{content_type}' "http://127.0.0.1:${port}/v1/meta" 2>/dev/null || true)"

  local content_type="${response##*$'\n'}"
  local rest="${response%$'\n'*}"
  local status="${rest##*$'\n'}"
  local body="${rest%$'\n'*}"

  if [[ -z "$status" ]] || [[ "$status" -lt 200 || "$status" -gt 299 ]]; then
    return 1
  fi
  if [[ "$content_type" == text/html* ]] || [[ "$body" == \<\!* ]]; then
    return 1
  fi

  local app repo_root
  app="$(json_field "$body" "app" || true)"
  repo_root="$(json_field "$body" "repo_root" || true)"
  if [[ -z "$app" ]]; then
    return 1
  fi

  printf '%s\t%s\n' "$app" "$repo_root"
}

probe_health() {
  local port="$1"
  curl -sS -m 1 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}/v1/health" 2>/dev/null || true
}

get_listeners() {
  lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null \
    | awk 'NR>1 && ($1 ~ /node|python|uvicorn|gunicorn/) {
        split($9, parts, ":");
        printf "%s\t%s\t%s\n", $1, $2, parts[length(parts)];
      }'
}

seen_ports=" "
v2_count=0

printf '%-6s %-12s %-40s %-8s %s\n' "PORT" "APP" "REPO_ROOT" "PID" "CMDLINE"
printf '%-6s %-12s %-40s %-8s %s\n' "----" "------------" "----------------------------------------" "--------" "-------"

while IFS=$'\t' read -r proc pid port; do
  [[ -z "$port" ]] && continue
  if [[ "$seen_ports" == *" ${port} "* ]]; then
    continue
  fi
  seen_ports="${seen_ports}${port} "

  app="unknown"
  repo_root="-"

  if meta="$(probe_meta "$port" 2>/dev/null)"; then
    app="$(printf '%s' "$meta" | awk -F '\t' '{print $1}')"
    repo_root="$(printf '%s' "$meta" | awk -F '\t' '{print $2}')"
  else
    health_code="$(probe_health "$port")"
    if [[ "$health_code" == "200" ]]; then
      app="unknown-api"
    fi
  fi

  if [[ "$app" == "zenops-v2" ]]; then
    v2_count=$((v2_count + 1))
  fi

  cmdline="$(ps -p "$pid" -o command= 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')"
  if [[ -z "$cmdline" ]]; then
    cmdline="${proc}"
  fi

  printf '%-6s %-12s %-40s %-8s %s\n' "$port" "$app" "${repo_root:0:40}" "$pid" "$cmdline"
done < <(get_listeners | sort -n -k3,3)

if [[ "$v2_count" -gt 1 && "$ALLOW_MULTIPLE_V2_APIS" != "1" ]]; then
  echo
  echo "ERROR: detected ${v2_count} ZenOps V2 API listeners. Set ALLOW_MULTIPLE_V2_APIS=1 to bypass."
  exit 2
fi
