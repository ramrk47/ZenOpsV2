# Traefik (Known Good for V1 Pilot)

Use this only if your VPS does not already run a working Traefik instance.

## Setup
```bash
cd legacy/v1/deploy/traefik
cp env.example .env
mkdir -p letsencrypt
touch letsencrypt/acme.json
chmod 600 letsencrypt/acme.json
docker network create traefik-proxy || true
docker compose up -d
```

## Required flags (already included)
- `--api.dashboard=true`
- `--api.insecure=true`
- `--entrypoints.web.address=:80`
- `--entrypoints.websecure.address=:443`
- `--providers.docker=true`

## Quick checks
```bash
curl -sS http://127.0.0.1:8088/api/overview
curl -sS http://127.0.0.1:8088/api/http/routers
curl -I http://127.0.0.1
```

## Docker API mismatch fix
If Traefik logs show:
`client version 1.24 is too old. Minimum supported API version is 1.44`
then Traefik cannot discover Docker routers/services. Recreate Traefik with this stack (uses `traefik:v3.6`):
```bash
cd legacy/v1/deploy/traefik
docker compose down
docker compose pull
docker compose up -d
```
