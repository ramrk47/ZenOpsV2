# Reverse Proxy (Caddy)

This setup uses a dedicated Caddy container as the public entrypoint:

- `/` → `frontend` container (static assets)
- `/api/*`, `/docs`, `/openapi.json`, `/healthz`, `/readyz`, `/version` → `api` container

## HTTPS (domain-based)

1. Set these in the root `.env` (used by Docker Compose):

```
CADDY_SITE=example.com
LETSENCRYPT_EMAIL=ops@example.com
```

2. Start the stack:

```
docker compose up -d reverse-proxy
```

Caddy will automatically request and renew TLS certificates.

## HTTP-only (no domain yet)

Set the site to an IP or `:80` to disable automatic HTTPS:

```
CADDY_SITE=http://<SERVER_IP>
# or
CADDY_SITE=:80
```

Then start the stack:

```
docker compose up -d reverse-proxy
```

## Reload proxy

Caddy watches its config and reloads automatically when the container is restarted:

```
docker compose restart reverse-proxy
```
