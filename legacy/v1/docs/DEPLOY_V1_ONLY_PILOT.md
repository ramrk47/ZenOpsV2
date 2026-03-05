# Deploy V1-Only Pilot (Traefik + Hostinger)

## Scope
- Deploys only `legacy/v1` on `https://zenops.notalonestudios.com`.
- Repogen/V2 are not deployed in this flow.

## DNS
- Required record:
  - `A  zenops.notalonestudios.com  -> 89.116.134.199`

## Ports / Firewall
- Open inbound TCP: `80`, `443`.
- Optional debug port (temporary): `8088` for Traefik dashboard/API on VPS localhost.

## Required Env Files
- `legacy/v1/.env`
- `legacy/v1/.env.backend`

Generate quickly:
```bash
cd ~/ZenOpsV2/legacy/v1
V1_DOMAIN=zenops.notalonestudios.com ./ops/bootstrap_v1_env.sh --force
```

## VPS Deploy Commands (Copy/Paste)
```bash
cd ~
rm -rf ZenOpsV2
git clone --branch codex/v1-pilot-deploy-v1only --single-branch https://github.com/ramrk47/ZenOpsV2.git
cd ~/ZenOpsV2/legacy/v1

# optional: edit .env/.env.backend for production secrets
nano .env
nano .env.backend

docker network create traefik-proxy || true

# Traefik (if not already running)
cd deploy/traefik
cp env.example .env
mkdir -p letsencrypt && touch letsencrypt/acme.json && chmod 600 letsencrypt/acme.json
docker compose up -d
cd ../../

# deploy app
./ops/deploy_pilot_v1.sh

# diagnostics + smoke
./ops/diag_traefik_v1.sh
./ops/diag_traefik_labels.sh
SMOKE_ADMIN_EMAIL='admin@zenops.local' SMOKE_ADMIN_PASSWORD='password' ./ops/smoke_v1_only.sh
```

## Expected Outputs
- `deploy_pilot_v1.sh`:
  - `PASS Traefik router API JSON has zenops-web + zenops-api`
  - `PASS /healthz over Traefik host-header: HTTP 200`
  - `PASS /readyz over Traefik host-header: HTTP 200`
  - `PASS /version over Traefik host-header: HTTP 200`
- `smoke_v1_only.sh`:
  - `PASS HTTP front-door`
  - `PASS HTTPS front-door`
  - `PASS analytics API (admin token): HTTP 200`
  - `PASS no 500s in last 200 API log lines`

## Rollback
```bash
cd ~/ZenOpsV2/legacy/v1
git fetch --all --tags
git checkout <last-known-good-commit-or-tag>
./ops/deploy_pilot_v1.sh
```

## Common Failures
1. ACME cert not issuing
- Check CAA allows `letsencrypt.org`.
- Confirm DNS A record points to VPS IP.
- Check Traefik logs: `docker logs --tail=200 traefik-traefik-1`.

2. `curl (52) Empty reply from server`
- Run:
  - `./ops/diag_traefik_v1.sh`
  - `./ops/diag_traefik_labels.sh`
- Usually wrong network or router/service label mismatch.

3. Traefik API `/api/http/routers` not JSON
- Dashboard/API flags missing in Traefik args.
- Use label diagnostics script even if dashboard is unavailable.

4. DB migrate timeout
- Verify `.env` and `.env.backend` passwords match `DATABASE_URL`.
- Reset volumes only for fresh install:
  - `docker compose -p zenops -f docker-compose.hostinger.yml -f docker-compose.pilot.yml down -v`
