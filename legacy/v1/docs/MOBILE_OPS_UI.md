# ZenOps V1 Mobile Ops UI

This document describes the mobile-first operations mode implemented in `legacy/v1/frontend`.

## Scope

- Mobile mode lives under `/m/*` in the existing SPA.
- Desktop routes remain unchanged.
- Role-aware mobile navigation is computed from existing RBAC capabilities.
- Existing API contracts are reused where possible.

## Route Map

- `/m/home` - role-aware dashboard (drafts, approvals, my day, uploads, unpaid invoices)
- `/m/assignments` - card list with search + status filters
- `/m/assignments/:id` - assignment summary with sticky actions
- `/m/assignments/:id/uploads` - checklist + camera-first uploads
- `/m/create` - step wizard for creating/updating draft assignments
- `/m/approvals` - approval inbox/detail with approve/reject
- `/m/invoices` - invoice list/detail and payment confirmation request flow
- `/m/notifications` - actionable notifications list
- `/m/search` - grouped quick search (assignments/invoices/approvals)
- `/m/profile` - account + capability snapshot + quick links
- `/m/uploads` - upload queue view (assignments with missing docs)

Legacy aliases:

- `/mobile` -> `/m/home`
- `/mobile/assignments/:id` -> `/m/assignments/:id`

## Role Behavior

### External Associate (`EXTERNAL_PARTNER`)

- Mobile tabs prioritize assignment creation and uploads.
- Can create draft assignments via `create_assignment_draft` capability.
- Draft creation remains approval-gated (backend draft flow).

### Admin/Ops

- Approvals and invoices are visible in mobile navigation.
- Payment actions on invoices use approval-governed backend behavior.

### Employee/Field

- Standard mobile tabs with assignment workflow support.
- Approvals tab appears only if `approve_actions` capability is enabled.

## Capability Gating

- Draft-create capability: `create_assignment_draft`
- Approvals: `approve_actions`
- Invoices: `view_invoices`
- Allocation action from detail: `assignment_allocate`

## Backend Changes Supporting Mobile

- `Role.EXTERNAL_PARTNER` now includes `create_assignment_draft` in RBAC defaults.
- Draft create endpoint checks capability (`create_assignment_draft`) instead of hardcoding field valuer role.

## Desktop Consistency

- `NewAssignment` now enters draft mode when `create_assignment_draft` is enabled and `create_assignment` is not.
- Partner desktop route added:
  - `/partner/assignments/new`
- Partner home now exposes a **Create Assignment** quick action when draft capability is present.

## Testing

### Frontend build

```bash
cd legacy/v1/frontend
npm run build
```

### Compose render sanity

```bash
cd legacy/v1
docker compose -f docker-compose.hostinger.yml -f docker-compose.pilot.yml config > /tmp/v1_mobile_rendered.yml
```

### Mobile Playwright smoke (new)

```bash
cd legacy/v1/playwright
npm install
npm run test:mobile
```

Optional env overrides for credentials/base URL:

- `PW_BASE_URL`
- `PW_ADMIN_EMAIL`
- `PW_ADMIN_PASSWORD`

## Notes

- Mobile mode banner appears on non-mobile routes for viewport `< 768px`, offering a non-forced jump to mobile mode.
- No backend contract rewrites were required for mobile list/detail/approval/invoice/upload flows.
