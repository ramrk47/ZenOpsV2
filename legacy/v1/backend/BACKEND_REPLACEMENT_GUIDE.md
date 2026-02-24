# Backend Replacement Guide (Zen Ops Repo)

This backend was fully restructured. Follow these steps to swap it into your `zen-ops` repo safely.

## 1. Back up your current backend

From the repo root:

```bash
mv backend backend_old_$(date +%Y%m%d_%H%M%S)
```

## 2. Copy this backend in

Copy this entire folder as the new `backend/`.

Your repo should look like:

- `zen-ops/backend/app/...`
- `zen-ops/backend/alembic/...`
- `zen-ops/backend/requirements.txt`

## 3. Set up Python + dependencies

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 4. Configure environment

```bash
cp .env.example .env
```

Defaults are already aligned to your local Postgres:

- DB name: `zenops`
- URL: `postgresql+psycopg2://postgres@localhost:5432/zenops`

Set a strong `JWT_SECRET` in `.env`.

## 5. Run migrations

```bash
alembic upgrade head
```

### If you have old tables/types

This will **wipe existing backend data** in `zenops`:

```bash
psql -d zenops -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
alembic upgrade head
```

## 6. Seed demo data (recommended for first run)

```bash
python -m app.seed
```

Admin login:

- `admin@zenops.local`
- `password`

## 7. Start the API

```bash
uvicorn app.main:app --reload
```

Docs: `http://127.0.0.1:8000/docs`

## Compatibility Notes

- Assignment summary/workload endpoints are implemented at:
  - `/api/assignments/summary`
  - `/api/assignments/workload`
- Leave approvals automatically create calendar events.
- Invoices are tied to assignment codes via invoice numbers:
  - `INV-{assignment_code}-NN`

## What Changed Architecturally

- Clear separation: `core/`, `db/`, `models/`, `schemas/`, `services/`, `routers/`
- Alembic is now first-class and required
- Enum names are standardized to stable database type names
- Approval engine and invoicing are properly integrated
