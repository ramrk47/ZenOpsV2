# Zen Ops Upgrades

Date: 2026-01-29

## Backend
- **Approval routing**: approvals now route by entity type (Assignment → OPS_MANAGER/ADMIN, Leave → HR/ADMIN, Invoice → FINANCE/ADMIN).
- **Self-approval guard**: requesters cannot approve their own requests (ADMIN exception for assignment approvals).
- **Approval templates**: `/api/approvals/templates` returns soft-approval presets for UI.
- **Approval inbox count**: `/api/approvals/inbox-count` provides quick badge counts.
- **Notifications**:
  - New types for approval approved/rejected, assignment assigned/reassigned, task due soon/overdue.
  - `/api/notifications/unread-count` returns totals + per-type counts.
  - `/api/notifications/sweep` generates SLA/task due alerts (recommended via cron).
- **Assignment code format**: new assignments use `Z-YYMM-####` format.
- **Service line tracking**: assignments now include `service_line` (VALUATION/INDUSTRIAL/DPR/CMA) for analytics.
- **Admin Analytics**: added an Intelligence workspace for source performance, trends, and action signals.
- **Calendar auto-events**: site visit & report due dates auto-create calendar events linked to assignments.
- **Leave assignment guard**: assigning tasks/assignments to users on approved leave requires `override_on_leave=true`.

## Frontend
- **Sidebar bubbles**: added “My Tasks” bubble (due/overdue count) and switched counts to unread/approval-count endpoints.
- **Calendar UX**: day/week/month grid view with iconography, hover details, and click-through to assignments or leave.
- **Notifications page**: search + type + date filters.
- **Approval requests**: uses approval templates with descriptions.
- **Document library**: shows latest version badges for each category.
- **Info tips**: added to all stat cards for quick context.
- **401 handling**: automatic logout on auth failure.

## Usage Notes
- Run a notification sweep manually:
  - `POST /api/notifications/sweep`
- Override leave assignment guard:
  - Include `override_on_leave: true` in assignment/task create/update.
- Smoke test:
  - `./scripts/validate.sh`
