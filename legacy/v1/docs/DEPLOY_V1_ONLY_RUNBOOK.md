# Deploy V1 Only (Post-9.5 Stable)

This runbook deploys only legacy V1 (no Repogen sidecar).

## Scope
- Deploy target: `legacy/v1/docker-compose.hostinger.yml`
- Excludes: `docker-compose.repogen.yml`
- Source branch: `codex/v1-pilot-deploy-v1only`

## DNS
Create records:
- `zenops.notalonestudios.com` -> VPS public IP

Verify:
```bash
dig +short zenops.notalonestudios.com
```

## Fresh install on VPS

```bash
cd ~
sudo rm -rf ZenOpsV2
git clone --branch codex/v1-pilot-deploy-v1only --single-branch https://github.com/ramrk47/ZenOpsV2.git
cd ~/ZenOpsV2/legacy/v1
```

## Generate server envs

```bash
V1_DOMAIN=zenops.notalonestudios.com ./ops/bootstrap_v1_env.sh --force
```

## Deploy V1

```bash
./ops/deploy_pilot_v1.sh
```

## Smoke

```bash
./ops/smoke_v1_hostinger.sh
```

If your reverse proxy is not terminating TLS yet, run smoke with explicit local base:

```bash
V1_BASE_URL=http://localhost:8000 ./ops/smoke_v1_hostinger.sh
```

## Common failures

1. `Database not reachable within timeout`
- Cause: mismatched DB credentials between `.env` and `.env.backend`, or stale volume with old password.
- Fix:
```bash
docker compose -p zenops -f docker-compose.hostinger.yml down -v --remove-orphans
./ops/up_v1_hostinger.sh
```

2. `/api/auth/me` is not `401` in smoke
- Cause: reverse proxy auth/header injection or wrong base URL.
- Fix: run with local base first:
```bash
V1_BASE_URL=http://localhost:8000 ./ops/smoke_v1_hostinger.sh
```

3. Domain resolves but app not reachable
- Ensure Traefik template is running and attached to `traefik-proxy`.
- Verify:
```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -i traefik
docker network inspect traefik-proxy >/dev/null 2>&1 && echo "traefik-proxy network exists"
./ops/diag_traefik_v1.sh
```
