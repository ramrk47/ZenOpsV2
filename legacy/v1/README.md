# Zen Ops – Internal Work OS

Zen Ops is a private operating system for valuation firms. It organises work around **assignments** and provides a single workspace for everything that happens in the business: chat, tasks, documents, approvals, invoices, leave management, scheduling and more.

This repository contains a FastAPI backend and a React frontend. The backend implements a role‑based access control (RBAC) system, JWT authentication, a PostgreSQL data store and a comprehensive API. The frontend uses Vite and React Router to deliver a responsive single–page application.

> **Note**: This project is an internal prototype. Some modules are placeholders with TODOs for future development.

## Documentation

* `docs/PROJECT_MAP.md` – system map (features, workflows, APIs, data model).
* `docs/AI_ENGINEERING_LOG.md` – append-only engineering log for multi-AI continuity.
* `docs/GIT_WORKFLOW.md` – safe Git workflow rules and snapshot protocol.
* `docs/ADR/` – architecture decision records.
* `docs/CHANGELOG.md` – Keep a Changelog formatted release notes.

## Developer Commands

* `scripts/verify_repo_hygiene.sh` – fail if `.env`, `.venv`, or `node_modules` are tracked.
* `scripts/new_log_entry.sh` – append a log entry skeleton (use `--stdout` to print).
* `scripts/validate.sh` – smoke test critical flows.

## Prerequisites

* macOS 12 or later (other OSes should work but paths may differ)
* Python 3.11+
* Node.js 18+
* PostgreSQL 13+

## Backend Setup

1. **Create and activate a Python virtual environment** (recommended):

   ```bash
   cd zen-ops/backend
   python -m venv venv
   source venv/bin/activate
   ```

2. **Install dependencies**:

   ```bash
   pip install -r requirements.txt
   ```

3. **Configure environment variables**:

   Copy the example environment file and edit the values as needed:

   ```bash
   cp .env.example .env
   # edit .env with your DB credentials and secret key
   ```

   Ensure that `DATABASE_URL` points to a PostgreSQL database. For local development you can create a database named `zenops_db` and a user `zenops_user` with a password, e.g.:

   ```bash
   createdb zenops_db
   createuser zenops_user --pwprompt
   psql -c "GRANT ALL PRIVILEGES ON DATABASE zenops_db TO zenops_user;"
   ```

4. **Run database migrations**:

   Alembic is configured to read the `DATABASE_URL` from your environment. To create all tables run:

   ```bash
   cd zen-ops/backend
   alembic upgrade head
   ```

   Alternatively, you may skip migrations and let the seed script create the schema for a development setup.

5. **Seed demo data** (optional but recommended):

   ```bash
   python -m app.seed
   ```

   This command creates an admin user (`admin@zenops.local`/`password`) and several other roles, along with ten sample assignments, tasks and messages.

6. **Start the backend server**:

   ```bash
   uvicorn app.main:app --reload
   ```

   The API is served at `http://localhost:8000`. An OpenAPI specification is automatically generated at `/docs`.

## Frontend Setup

1. **Install dependencies**:

   ```bash
   cd zen-ops/frontend
   npm install
   ```

2. **Configure environment variables**:

   Copy the example environment file and specify the base URL of your backend:

   ```bash
   cp .env.example .env
   # inside .env set VITE_API_URL=http://localhost:8000
   ```

3. **Run the development server**:

   ```bash
   npm run dev
   ```

   The app will be available at `http://localhost:5173`. During development CORS is enabled on the backend to allow the frontend to call the API.

## Email Notifications (Optional)

Zen Ops can deliver notification emails via a background worker. Configure the email provider in `.env.backend` and start the worker process.

Required env variables:
- `EMAIL_PROVIDER` (resend | postmark | smtp | disabled)
- `EMAIL_API_KEY` (for Resend/Postmark)
- `EMAIL_FROM` (e.g., `no-reply@yourdomain.com`)
- `APP_BASE_URL` (portal base URL used in links)

Worker command (run separately from the API):
```bash
python -m app.scripts.notification_worker --interval 30
```

With Docker, enable the `email-worker` service in `docker-compose.yml` / `docker-compose.dev.yml`.

## RBAC

The system defines several roles (`ADMIN`, `OPS_MANAGER`, `HR`, `FINANCE`, `ASSISTANT_VALUER`, `FIELD_VALUER`, `EMPLOYEE`). Each role has a set of capabilities exposed via the `/api/auth/capabilities` endpoint. The frontend reads these capabilities to show or hide UI controls.

## Seeded Accounts

After running the seed script the following users are available (all passwords are `password`):

| Email                | Role              |
|----------------------|-------------------|
| admin@zenops.local   | ADMIN             |
| ops@zenops.local     | OPS_MANAGER       |
| hr@zenops.local      | HR                |
| finance@zenops.local | FINANCE           |
| assistant@zenops.local | ASSISTANT_VALUER |
| field@zenops.local   | FIELD_VALUER      |

Log in as the admin to create additional users, manage assignments and approve requests.

## Smoke Validation

Run a lightweight smoke test (uses a temporary SQLite DB, no Postgres required):

```bash
./scripts/validate.sh
```

This covers login, assignment creation/filtering, assignment detail load, task notification, approval inbox, leave calendar block, invoice number linkage, reminder idempotency, and overdue follow-up task dedupe.

Manual invoice checklist:
- Reminder sent (Finance/Admin) and a PAYMENT_PENDING notification appears.
- Second reminder within 24h is blocked unless Idempotency-Key is reused.
- Overdue follow-up task created once per invoice and calendar event shows PAYMENT_FOLLOWUP.

## Linting and Testing

This repository does not yet include full automated tests. The smoke script above validates the most critical flows. You can run `flake8` or similar tools manually to check code style. A `pre-commit` configuration can be added later.

## Hostinger VPS Deployment (Traefik)

This repo includes `docker-compose.hostinger.yml` for production deployment behind Hostinger's Traefik template.

Important rules:
- Do not expose app containers on host ports `80/443`. Only Traefik should bind those ports.
- Do not run `docker compose down -v` on production. PostgreSQL volume data is persistent and must be preserved.
- Frontend production API calls use same-origin `/api` routing (no browser `localhost` API calls).

### Step 0: Deploy Hostinger Traefik Template

In Hostinger Docker Manager, deploy the Traefik template first. It should create/own the public `80/443` entrypoints.

### Step 1: DNS

Create an A record:
- `${ZENOPS_DOMAIN}` -> your VPS public IP

Example:
- `zenops.example.com` -> `203.0.113.10`

### Step 2: External Network (`traefik-proxy`)

`docker-compose.hostinger.yml` expects an external network named `traefik-proxy`.

Verify/create:
```bash
docker network inspect traefik-proxy >/dev/null 2>&1 || docker network create traefik-proxy
```

### Step 3: Server Env Files (no secrets in git)

Put server env files on the VPS (do not commit secrets):
- `.env.backend`
- optional shell env exports for compose variables (`ZENOPS_DOMAIN`, image tags, backup paths, etc.)

Recommended runtime variables:
- `ZENOPS_DOMAIN=zenops.example.com`
- `TRAEFIK_CERTRESOLVER=letsencrypt`
- `COMPOSE_PROJECT_NAME=zenops`
- `BACKUP_HOST_PATH=/opt/zenops/backups`
- `RCLONE_SECRETS_DIR=/opt/zenops/secrets`

If using rclone sync, put config here (not in git):
- `/opt/zenops/secrets/rclone.conf`

### Step 4: Deploy Commands

Project isolation uses Compose project name `zenops`:
```bash
docker compose -f docker-compose.hostinger.yml -p zenops pull
COMPOSE_FILE=docker-compose.hostinger.yml COMPOSE_PROJECT_NAME=zenops ./ops/deploy.sh
```

Deploy workflow is:
1. pull images
2. pre-migration `pg_dump` backup
3. `alembic upgrade head` (migrate job)
4. bring up services
5. verify `/readyz`

### Step 5: Smoke Checklist

1. Open `https://${ZENOPS_DOMAIN}` and login.
2. Open Assignments list (must load without API errors).
3. Open an Assignment detail page.
4. In Documents flow, verify upload and preview drawer.
5. Verify Admin pages load: Master Data, Personnel, Support Inbox, Backups.
6. Verify background worker behavior for your environment:
   - if email enabled: notifications/jobs process
   - if email disabled: worker is healthy and idle

### Backup and Restore

One-off backup:
```bash
COMPOSE_FILE=docker-compose.hostinger.yml COMPOSE_PROJECT_NAME=zenops ./ops/backup_now.sh
```

One-off migration:
```bash
COMPOSE_FILE=docker-compose.hostinger.yml COMPOSE_PROJECT_NAME=zenops ./ops/migrate.sh
```

Image rollback:
```bash
COMPOSE_FILE=docker-compose.hostinger.yml COMPOSE_PROJECT_NAME=zenops ./ops/rollback.sh
```
`rollback.sh` uses image references captured by the last successful `./ops/deploy.sh` run in `ops/releases/previous-images.env`.

Manual DB restore (explicit action only):
```bash
gunzip -c /opt/zenops/backups/<backup-file>.sql.gz \
  | docker compose -f docker-compose.hostinger.yml -p zenops exec -T db \
      psql -U "${POSTGRES_USER:-zenops}" -d "${POSTGRES_DB:-zenops}"
```

For scheduled backups, run a host cron entry that triggers:
```bash
docker compose -f /opt/zenops/docker-compose.hostinger.yml -p zenops --profile backup run --rm backup
```

## Mobile Cockpit /m + PWA Install

Zen Ops includes a mobile-first cockpit at `/m` (also `/mobile` redirect) on the same origin as the main app, so API calls stay same-origin via `/api/...`.

What it includes:
- Status cards: unread notifications, approvals pending, overdue assignments, payments pending
- `My Queue` top 20 assignments with overdue-first ordering
- Mobile assignment view: overview, latest timeline, documents upload, comments, raise request
- Role-safe behavior: partner users see partner-scoped data only via `/api/mobile/*`

PWA setup:
- Built with `vite-plugin-pwa`
- Manifest start URL is `/m`
- Standalone display mode enabled
- Icons included:
  - `frontend/public/pwa-192x192.png`
  - `frontend/public/pwa-512x512.png`

Offline/weak network behavior:
- App shell is cached by service worker
- `/m` uses network-first data loading, then falls back to local snapshot (`localStorage`)
- Last 20 status snapshots are stored locally for offline visibility
- Static fallback page for `/m` navigation: `frontend/public/offline-mobile.html`

Installability checks (Chrome):
1. Open app over HTTPS.
2. Open DevTools -> Application -> Manifest and verify manifest fields/icons.
3. Open DevTools -> Application -> Service Workers and verify active SW.
4. Use browser Install prompt or menu `Install app`.
5. Launch installed app and confirm it opens directly to `/m` in standalone mode.

## Contribution

This project is a starting point. Contributions and improvements are welcome. Please file issues for any bugs or missing functionality.
