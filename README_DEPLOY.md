# Zen Ops – Production Deploy on a Single VPS

This guide deploys Zen Ops with Docker Compose on a single VPS (FastAPI + Postgres + React/Vite).

## Prerequisites

- Ubuntu 22.04+ (or equivalent)
- Docker + Docker Compose
- A domain name (recommended) or a static IP for HTTP-only mode

## 1) Install Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

## 2) Clone the repo

```bash
git clone <your-repo-url> zen-ops
cd zen-ops
```

## 3) Create env files

```bash
cp .env.prod.example .env
cp .env.backend.example .env.backend
cp .env.frontend.example .env.frontend
```

Edit the files with real values:

Required:
- `.env`: `POSTGRES_PASSWORD`, `CADDY_SITE`, `LETSENCRYPT_EMAIL`, `VITE_API_URL`
- `.env.backend`: `JWT_SECRET`, `ALLOW_ORIGINS`, `BACKUP_ADMIN_PIN`, `APP_BASE_URL`

Recommended:
- `.env.backend`: `LOGIN_MAX_ATTEMPTS`, `LOGIN_WINDOW_MINUTES`, `EMAIL_*` (if using outbound email)

HTTP-only (no domain yet):
- `.env`: `CADDY_SITE=http://<SERVER_IP>` and `VITE_API_URL=http://<SERVER_IP>`
- `.env.backend`: `ALLOW_ORIGINS=http://<SERVER_IP>`

## 4) Build and start

```bash
docker compose build
docker compose up -d db
docker compose run --rm migrate
docker compose up -d
```

### Staging only: seed demo data

Do **not** run this in production.

```bash
docker compose run --rm api python -m app.seed
```

## 5) Verify health

```bash
curl https://<your-domain>/healthz
curl https://<your-domain>/readyz
curl https://<your-domain>/version
```

HTTP-only mode:

```bash
curl http://<SERVER_IP>/healthz
```

## 6) Confirm the email worker

```bash
docker compose logs -f email-worker
```

If `EMAIL_PROVIDER=disabled`, you should see a log line indicating the worker is skipping delivery.

## 7) Backups

Manual backup:

```bash
mkdir -p deploy/backups deploy/rclone
docker compose --profile backup run --rm backup
ls -lah deploy/backups
```

Nightly backups (02:30 server time):

```bash
docker compose --profile backup up -d backup-cron
```

If you set `RCLONE_REMOTE`, you **must** also set `BACKUP_ENCRYPTION_KEY`.

Optional (UI-triggered backups):

```bash
docker compose --profile backup up -d backup-dispatcher
```

## Security hardening notes

- Login rate limiting is enforced by the API (`LOGIN_MAX_ATTEMPTS`, `LOGIN_WINDOW_MINUTES`).
- CORS is locked down via `ALLOW_ORIGINS` in `.env.backend` (no `*` in production).
- `JWT_SECRET` must be a long, random value (the API refuses `change_me` in production).
- Do **not** seed demo users in production; rotate any default credentials immediately if used.
- Proxy headers are trusted so `X-Forwarded-Proto` works behind the reverse proxy.
- Admin endpoints are RBAC-protected; backup actions require `BACKUP_ADMIN_PIN`.

## Observability

- API and worker logs are JSON structured (Docker logs capture them).
- Docker log rotation is enabled (`max-size=10m`, `max-file=3`).
- Optional: add Loki/Grafana if you want centralized log search and dashboards.

## Runbook: where to look when it breaks

1. `docker compose ps` to confirm containers are healthy.
2. `docker compose logs -f reverse-proxy` for TLS or routing errors.
3. `docker compose logs -f api` for 5xx or migration errors.
4. `docker compose logs -f email-worker` for email delivery failures.
5. `docker compose logs -f db` if the API cannot connect.
6. `curl /readyz` to confirm migrations are applied.
7. Check disk space: backups and uploads can fill the VPS.
8. Validate backups: `ls -lah deploy/backups` and run a monthly restore test.
