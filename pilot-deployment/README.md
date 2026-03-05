# Pilot Deployment Wrapper (V1 + Repogen Slice)

This folder is a thin deployment wrapper for ZenOps pilot operations.

- Source of truth app code remains in `legacy/v1/**` and existing Repogen slice compose.
- This wrapper only adds deployment compose wiring, env templates, and operator scripts.
- Update path stays simple: `git pull` then `docker compose up -d --build`.

## Modes

1. Traefik/Hostinger mode (recommended for VPS)
- Uses `pilot-deployment/compose.pilot.yml`
- Wraps:
  - `legacy/v1/docker-compose.hostinger.yml`
  - `legacy/v1/docker-compose.repogen.yml`
- Profiles:
  - `v1` (legacy/v1 stack)
  - `repogen` (Repogen sidecar slice)

2. Local quick test mode
- Uses legacy dev compose directly (`legacy/v1/docker-compose.dev.yml`) plus Repogen slice compose.
- Fast local verification path before VPS rollout.

## Fresh Clone -> Deploy (VPS)

```bash
git clone <your-repo-url> ZenOpsV2
cd ZenOpsV2
git checkout codex/pilot-deployment-wrapper

cp pilot-deployment/env/v1.env.example pilot-deployment/env/v1.env
cp pilot-deployment/env/repogen.env.example pilot-deployment/env/repogen.env

# Backend env file required by legacy/v1 hostinger compose services.
cp legacy/v1/.env.prod.example legacy/v1/.env.backend
# Edit the file and set real production secrets.
```

Edit both env files before first run:
- `pilot-deployment/env/v1.env`
- `pilot-deployment/env/repogen.env`
- `legacy/v1/.env.backend`

Bring up stack:

```bash
./pilot-deployment/scripts/up.sh
```

Run smoke:

```bash
./pilot-deployment/scripts/smoke.sh
```

Expected smoke ending:
- `[smoke-repogen] PASS: V1 + Repogen deployment smoke checks succeeded`

## Update Flow (VPS)

```bash
git pull --ff-only
./pilot-deployment/scripts/update.sh
./pilot-deployment/scripts/smoke.sh
```

## Local Quick Test

```bash
# optional local env bootstrap
cp pilot-deployment/env/v1.env.example pilot-deployment/env/v1.env
cp pilot-deployment/env/repogen.env.example pilot-deployment/env/repogen.env
cp legacy/v1/.env.example legacy/v1/.env.backend

./pilot-deployment/scripts/up.sh --mode local
./pilot-deployment/scripts/smoke.sh
```

## Scripts

- `scripts/up.sh`: starts stack in hostinger mode (default) or local mode.
- `scripts/update.sh`: `git pull --ff-only` then rebuild/up in selected mode.
- `scripts/smoke.sh`: loads env files and executes `legacy/v1/ops/smoke_deploy_repogen.sh`.

## Required Runtime Inputs

- Traefik network exists on VPS (default `traefik-proxy`) for hostinger mode.
- Valid domain DNS for V1 and Repogen.
- Strong secrets for JWT/session variables in `legacy/v1/.env.backend` and repogen env.

