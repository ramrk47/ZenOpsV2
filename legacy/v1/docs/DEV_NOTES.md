# Dev Notes

Date: 2026-01-29

## Summary of Changes
- Added approval routing/eligibility enforcement and approval templates.
- Added notification types, unread counts, and sweep endpoint for due/overdue alerts.
- Simplified assignment codes (`Z-YYMM-####`) and aligned invoice numbering (`{assignment_code}-I##`).
- Added service line metadata and analytics endpoints + admin UI.
- Auto-upserted calendar events for assignment site visits/report due dates.
- Added leave assignment guards with override flag.
- Improved frontend UX for calendar, notifications, approvals, document versioning, and stats info tips.
- Assignment detail now surfaces approval templates with descriptions and highlights latest document versions.
- Added smoke validation script.

## Key Files Touched
- Backend:
  - `app/models/enums.py` (notification types)
  - `app/services/approvals.py`, `app/routers/approvals.py`
  - `app/services/notification_sweep.py`, `app/routers/notifications.py`
  - `app/services/calendar.py`, `app/routers/calendar.py`
  - `app/routers/assignments.py`, `app/schemas/assignment.py`
  - `app/routers/tasks.py`, `app/schemas/task.py`
  - `alembic/versions/0005_expand_notification_types_v2.py`
- Frontend:
  - `src/pages/CalendarPage.jsx`, `src/pages/NotificationsPage.jsx`
  - `src/pages/AssignmentDetail.jsx`, `src/pages/RequestsPage.jsx`
  - `src/components/Navbar.jsx`, `src/auth/AuthContext.jsx`
  - `src/styles.css`
- Scripts:
  - `scripts/smoke_backend.py`, `scripts/validate.sh`

## Why
- Tighten RBAC and approval integrity.
- Provide reliable notification loop for SLA/task pressure.
- Reduce calendar chaos by auto-generating key events.
- Enforce leave-awareness in assignment/task allocation.
- Improve UX clarity with info tips and actionable shortcuts.
