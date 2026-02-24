# Zen Ops Backend

A work-OS backend for valuation operations built with FastAPI, SQLAlchemy 2.x, PostgreSQL, Alembic, JWT auth, and RBAC.

Assignments are the core object. Everything attaches to assignments, people, or calendar: tasks, chat, docs, approvals, invoices, leave, SLA alerts, notifications, and audit trail.

## What’s Included

- Full domain model with strong relationships and auditability
- RBAC capabilities endpoint at `/api/auth/capabilities`
- Assignment filters including `assigned_to_user_id` and `mine=true`
- SLA due-time computation and escalation signals
- Invoicing tied to assignment codes (`{assignment_code}-I##`)
- Human-friendly assignment codes (`Z-YYMM-####`) for new assignments
- Leave approvals create calendar events automatically
- Notification sweep endpoint for SLA/task due alerts
- Master data management for banks/branches/clients/property types and company accounts
- Alembic migrations and a complete seed script

## Local Setup (Mac-Friendly)

### 1. Create the database

This backend is configured for a local Postgres DB named `zenops` with no password:

```bash
createdb zenops
```

### 2. Create and activate a virtualenv

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure environment

Copy `.env.example` to `.env` and adjust if needed:

```bash
cp .env.example .env
```

Important defaults:

- `DATABASE_URL=postgresql+psycopg2://postgres@localhost:5432/zenops`
- `JWT_SECRET=...`

### 5. Run migrations

```bash
alembic upgrade head
```

If you have old tables/types from previous versions, reset the schema:

```bash
psql -d zenops -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
alembic upgrade head
```

### 6. Seed demo data

```bash
python -m app.seed
```

Demo login:

- Email: `admin@zenops.local`
- Password: `password`
- Partner: `patil@partner.local` / `password`

### 7. Run the API

```bash
uvicorn app.main:app --reload
```

Docs:

- Swagger UI: `http://127.0.0.1:8000/docs`
- Health: `http://127.0.0.1:8000/healthz`

## Key Endpoints

Auth:

- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/auth/capabilities`
- `CRUD /api/auth/users`

Assignments:

- `GET /api/assignments`
- `GET /api/assignments/with-due`
- `GET /api/assignments/{id}`
- `GET /api/assignments/{id}/detail`
- `PATCH /api/assignments/{id}`
- `DELETE /api/assignments/{id}` (approval or admin direct)
- `GET /api/assignments/summary`
- `GET /api/assignments/workload`

Nested:

- Tasks: `/api/assignments/{id}/tasks`
- Messages: `/api/assignments/{id}/messages`
- Documents: `/api/assignments/{id}/documents`

Ops & Admin:

- Approvals: `/api/approvals/*`
- Leave: `/api/leave/*`
- Calendar: `/api/calendar/events`
- Notifications: `/api/notifications`
- Notifications: `/api/notifications/unread-count`, `/api/notifications/sweep`
- Dashboard: `/api/dashboard/overview`
- Master Data: `/api/master/*`
- Invoices: `/api/invoices/*`
- Approvals Templates: `/api/approvals/templates`
- Approvals Inbox Count: `/api/approvals/inbox-count`

Partner Portal:

- `POST /api/partner/commissions`
- `POST /api/partner/commissions/{id}/submit`
- `GET /api/partner/commissions`
- `GET /api/partner/requests`
- `POST /api/partner/requests/{id}/respond`
- `POST /api/partner/requests/{id}/uploads`
- `GET /api/partner/assignments`
- `GET /api/partner/invoices`
- `GET /api/partner/assignments/{id}/deliverables`
- `GET /api/partner/deliverables/{id}/download`
- `GET /api/partner/notifications`
- `GET /api/partner/profile`

Partner Admin:

- `GET /api/admin/commissions`
- `POST /api/admin/commissions/{id}/approve`
- `POST /api/admin/commissions/{id}/reject`
- `POST /api/admin/commissions/{id}/needs-info`
- `POST /api/admin/partner-requests`
- `POST /api/admin/assignments/{id}/deliverables/release`

## Notes on Structure

- `app/core`: settings, auth, RBAC, dependencies
- `app/db`: base metadata + session
- `app/models`: SQLAlchemy 2.x models and enums
- `app/schemas`: Pydantic v2 schemas
- `app/services`: domain logic and integrations
- `app/routers`: API endpoints
- `alembic/`: migrations

## Quick Validation Script (Optional)

The following was used to validate core flows locally:

```bash
python - <<'PY'
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)
resp = client.post('/api/auth/login', data={'username': 'admin@zenops.local', 'password': 'password'})
print(resp.status_code)
headers = {'Authorization': f"Bearer {resp.json()['access_token']}"}
for path in ['/api/assignments/with-due','/api/assignments/summary','/api/assignments/workload','/api/master/banks','/api/invoices','/api/leave/inbox','/api/calendar/events']:
    r = client.get(path, headers=headers)
    print(path, r.status_code)
PY
```

## Smoke Validation (Recommended)

Run a full smoke test (isolated SQLite DB):

```bash
./scripts/validate.sh
```
