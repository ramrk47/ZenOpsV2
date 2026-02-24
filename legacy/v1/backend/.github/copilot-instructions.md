# Copilot Instructions for Zen Ops Backend

## Architecture Overview
- **FastAPI-based backend**: Main entry is [`app/main.py`](../app/main.py). All API routes are registered here.
- **Modular routers**: Each domain (assignments, users, tasks, invoices, etc.) has its own router in [`app/routers/`](../app/routers/), e.g., `assignments.py`, `users.py`.
- **SQLAlchemy ORM**: Models are in [`app/models/`](../app/models/). All inherit from `Base` ([`base.py`](../app/models/base.py)).
- **RBAC**: Role-based access control is defined in [`utils/rbac.py`](../app/utils/rbac.py) and enforced in routers.
- **Database**: Uses PostgreSQL. Connection via `DATABASE_URL` in environment. Session management in [`db.py`](../app/db.py).
- **Seeding**: [`app/seed.py`](../app/seed.py) creates tables and demo data. Run with `python -m app.seed`.
- **Security**: Passwords hashed with bcrypt. JWT auth via [`utils/security.py`](../app/utils/security.py).

## Developer Workflows
- **Run dev server**: `uvicorn app.main:app --reload` (ensure `.env` with `DATABASE_URL` is set)
- **Seed database**: `python -m app.seed` (idempotent, aborts if users exist)
- **Environment**: Load variables from `.env` (see [`db.py`](../app/db.py)).
- **API docs**: Available at `/docs` when server is running.

## Project Conventions
- **API Prefixes**: All endpoints are under `/api/` (see router `prefix` args).
- **RBAC**: Use `rbac.get_capabilities(user.role)` to check permissions. See [`utils/rbac.py`](../app/utils/rbac.py) for capability flags.
- **User roles**: Defined in [`models/user.py`](../app/models/user.py) as `Role` enum.
- **Password hashing**: Use `get_password_hash` from [`utils/security.py`](../app/utils/security.py).
- **JWT tokens**: Created with `create_access_token` in [`utils/security.py`](../app/utils/security.py).
- **File uploads**: Documents stored in directory from `UPLOAD_DIR` env var.

## Integration Points
- **PostgreSQL**: Set `DATABASE_URL` in `.env`.
- **JWT**: Requires `SECRET_KEY` and `ALGORITHM` in `.env`.
- **CORS**: Configured for local frontend dev (see `origins` in [`main.py`](../app/main.py)).

## Examples
- **Add a new API route**: Create a new file in [`app/routers/`](../app/routers/) and include it in [`main.py`](../app/main.py).
- **Add a new model**: Define in [`app/models/`](../app/models/), import in [`seed.py`](../app/seed.py) if seeding needed.
- **Enforce permissions**: Use RBAC checks in endpoints, e.g., `if not rbac.get_capabilities(user.role)["manage_users"]: ...`

## Key Files
- [`app/main.py`](../app/main.py): App entry, router registration
- [`app/db.py`](../app/db.py): DB connection/session
- [`app/seed.py`](../app/seed.py): Data seeding
- [`app/utils/rbac.py`](../app/utils/rbac.py): RBAC logic
- [`app/utils/security.py`](../app/utils/security.py): Security helpers
- [`app/models/`](../app/models/): ORM models
- [`app/routers/`](../app/routers/): API endpoints

---
For more, see docstrings in each module. Update this file if conventions or workflows change.
