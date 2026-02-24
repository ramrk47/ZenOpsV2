# Project Map

## 1) Product Mental Model
Zen Ops centers on **Assignments**. Everything else attaches to an assignment (tasks, messages, documents, approvals, invoices, calendar events, notifications). The product has three UI surfaces:
- Admin UI for oversight, analytics, approvals, master data, and workforce management.
- Employee UI for day-to-day work execution.
- Partner UI for external partner requests, payments, and deliverables.

## 2) Role Model
Roles live in `backend/app/models/enums.py` and are enforced by `backend/app/core/rbac.py`.
- Roles: ADMIN, OPS_MANAGER, HR, FINANCE, ASSISTANT_VALUER, FIELD_VALUER, EMPLOYEE, EXTERNAL_PARTNER.
- Multi-role support: `users.roles` stores a list of roles; capabilities are the union of all roles.
- Primary role: `users.role` remains the primary/default role for display and legacy logic.
- Partner rule: EXTERNAL_PARTNER must be a single role (no mixing with others).

## 3) Backend Architecture
- Entry point: `backend/app/main.py` (routers, CORS, request logging, health endpoints).
- Routers: `backend/app/routers/` (domain grouping by feature).
- Services: `backend/app/services/` (business logic, notifications, approvals, invoices, partners).
- Models: `backend/app/models/` (SQLAlchemy ORM).
- Schemas: `backend/app/schemas/` (Pydantic API contracts).
- Settings: `backend/app/core/settings.py` (env-driven configuration).
- Migrations: `backend/alembic/versions/` (Alembic revisions).

## 4) Frontend Routes and UI Roles
Routes are defined in `frontend/src/App.jsx`.
- Employee area: `/account`, `/assignments`, `/calendar`, `/notifications`, `/invoices`, `/requests`.
- Admin area: `/admin/dashboard`, `/admin/workload`, `/admin/approvals`, `/admin/open-queue`, `/admin/activity`, `/admin/backups`, `/admin/analytics`, `/admin/personnel`, `/admin/partners/:id`, `/admin/masterdata`, `/admin/company`, `/admin/notification-deliveries`.
- Partner area: `/partner`, `/partner/requests`, `/partner/requests/new`, `/partner/requests/:id`, `/partner/payments`, `/partner/notifications`, `/partner/profile`, `/partner/help`.
- Layouts: `frontend/src/components/layout/AdminLayout.jsx`, `EmployeeLayout.jsx`, `PartnerLayout.jsx`.

## 5) Key Workflows
Assignment lifecycle:
- Create assignment → assign staff → tasks/messages/documents → approvals → invoice → payment → completion.
Approvals:
- Approvals are requested through `/api/approvals` and routed by role (see `backend/app/services/approvals.py`).
Leave management:
- Leave requests via `/api/leave`; approvals notify HR/Admin; calendar events are created for leave periods.
Invoices and payments:
- Invoices are created and updated via `/api/invoices`; payments mark assignments as paid and trigger notifications.
- Reminder throttling and idempotency safeguards exist in invoice services.
Partner commissioning workflow:
- External partners create requests through `/api/partner` and admins manage releases in `/api/admin` partner routes.

## 6) API Index (by router)
Auth and session:
- `backend/app/routers/auth.py` (login, register, self profile, capabilities).
Users:
- `backend/app/routers/users.py` (user management, reset password, directory).
Assignments and tasks:
- `backend/app/routers/assignments.py`, `backend/app/routers/tasks.py`, `backend/app/routers/tasks_overview.py`, `backend/app/routers/assignment_metrics.py`.
Messaging and documents:
- `backend/app/routers/messages.py`, `backend/app/routers/documents.py`.
Approvals and leave:
- `backend/app/routers/approvals.py`, `backend/app/routers/leave.py`.
Calendar:
- `backend/app/routers/calendar.py`.
Invoices:
- `backend/app/routers/invoices.py`.
Notifications and activity:
- `backend/app/routers/notifications.py`, `backend/app/routers/activity.py`.
Admin dashboards and analytics:
- `backend/app/routers/dashboard.py`, `backend/app/routers/analytics.py`.
Master data and company accounts:
- `backend/app/routers/master.py`, `backend/app/routers/company.py`.
Partner portal and partner admin:
- `backend/app/routers/partner.py`, `backend/app/routers/partner_admin.py`.
Backups:
- `backend/app/routers/backups.py`.

## 7) Data Model Map (High Level)
Core entities:
- Users (`users`) with roles, capability overrides, and partner linkage.
- Assignments (`assignments`) with assignees, tasks, messages, documents, approvals, and invoices.
Supporting entities:
- Approvals (`approvals`) and Activity logs (`activity_logs`).
- Notifications (`notifications`) and deliveries (`notification_deliveries`) with preferences.
- Invoices (`invoices`), items, payments, adjustments, and audit logs.
- Leave requests (`leave_requests`) and calendar events (`calendar_events`).
- External partners (`external_partners`) and partner requests/commissioning tables.

## 8) Background Workers
Email delivery worker:
- `backend/app/scripts/notification_worker.py` (polls pending notification deliveries, sends email).
Notification sweeps:
- Triggered via `/api/notifications/sweep` (admin/ops) for queued alerts and reminders.

## 9) Operational Processes
Environment configuration:
- Backend: `.env.backend` (JWT, DB, email, backup settings).
- Frontend: `.env.frontend` (API URL).
Migrations and seed:
- `alembic upgrade head` and `python -m app.seed`.
Docker:
- `docker-compose.yml` defines api, db, frontend, reverse proxy, worker, and backup services.

## 10) Observability and Logging
- JSON structured logs via `backend/app/core/logging.py` with `X-Request-Id` propagation.
- Health endpoints: `/healthz`, `/readyz`, `/version` in `backend/app/main.py`.
- Security events are logged on auth failures and forbidden responses.

## 11) Deployment Readiness Checklist (Docs-Only)
- Verify `.env.backend` and `.env.frontend` are populated with production values.
- Run `alembic upgrade head` and confirm `/readyz` reports the expected revision.
- Confirm reverse proxy routes and TLS (if enabled).
- Validate backup job runs and restore script works against a test DB.
- Confirm notification worker is running and email provider is configured.

## 12) Known Constraints + TODOs
- No comprehensive automated test suite; rely on `scripts/validate.sh` for smoke coverage.
- External partners are single-role only by design.
- Some modules are marked as placeholders in README and may require product decisions.
