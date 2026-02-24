# Zen Ops Audit Report

Date: 2026-01-29

## Critical Issues
- **Approval routing too permissive**: approvals were visible to any approver role without routing by entity type, enabling Finance to approve HR leave or Ops to approve invoices. **Fixed** by role-based routing per entity type and eligibility checks.
- **Self-approval loophole**: requesters could approve their own requests. **Fixed** by blocking self-approval (exception: ADMIN for assignment-related approvals).
- **Financial fields on assignment creation**: non-finance roles could set `fees`/`is_paid` during creation. **Fixed** with strict permission checks.
- **Approval notifications missing in several workflows**: delete assignment, invoice mark-paid, and user reset approvals did not notify approvers. **Fixed** with role-aware notifications.

## High-Priority Workflow Gaps
- **No due-soon/overdue notification loop**: SLA and task escalations were manual only. **Fixed** via notification sweep endpoint and new notification types.
- **Calendar missing auto events for site visits & report due**: operations had to log these manually. **Fixed** by auto-upserting assignment events.
- **Assignment/task assignment during leave**: no warning before assigning a user on approved leave. **Fixed** with leave conflict guard + override flag in API and UI.
- **Approval templates**: soft approvals lacked discoverability. **Fixed** with `/api/approvals/templates` and UI support.
- **Missing docs reminder action**: checklist shows required/missing categories but has no one-click reminder workflow yet.
- **Timeline ordering**: timeline display relies on default DB ordering; needs explicit newest-first sorting.

## Tech Debt
- **Duplicate RBAC & dependency helpers**: `app/utils/rbac.py` and `app/dependencies.py` exist alongside `app/core/*`. Partially addressed by routing company endpoints through `app/core/*`, but legacy files remain.
- **Notification dedupe**: repeated notifications risk spam. Mitigated with `create_notification_if_absent`, but long-term needs richer scheduling controls.
- **Limited automated tests**: no CI test suite. Added smoke validation script but full test coverage is still missing.

## Recommendations
- Add a background scheduler (Celery/APS) to call `/api/notifications/sweep` hourly.
- Remove legacy RBAC/deps modules to prevent drift.
- Add RBAC integration tests for approvals, invoices, and assignment reassignment.
- Expand calendar to include drag/drop rescheduling and assignment capacity planning.
- Add a richer global search + command palette for faster navigation.
- Build “My Day” employee home (due/overdue, quick updates, templates).
- Add assignment health badges (missing docs, overdue, payment pending) on list/detail.
- Add missing-doc reminder generator (notification + task/message template).
