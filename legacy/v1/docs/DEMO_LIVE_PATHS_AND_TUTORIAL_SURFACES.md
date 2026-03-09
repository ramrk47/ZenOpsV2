# Demo Live Paths And Tutorial Surfaces

This note answers the immediate question: which UI paths are live in the current demo, and which files own them in the deployed V1 codebase.

Scope:
- Repo/worktree: `ZenOpsV2/.worktrees/v1-repogen-deploy`
- Branch: `codex/v1-pilot-deploy-v1only`
- App scope: `legacy/v1`

## Short Answer

Yes. The current demo already exposes a usable route surface for a guided tutorial system.

The most important live paths for tutorial work are:
- Mobile home: `/m/home`
- Mobile assignments list: `/m/assignments`
- Mobile assignment detail: `/m/assignments/:id`
- Mobile uploads: `/m/assignments/:id/uploads` and `/m/uploads`
- Mobile draft creation: `/m/create`
- Mobile associate request composer: `/m/request/new`
- Mobile approvals: `/m/approvals`
- Mobile invoices: `/m/invoices`
- Mobile search: `/m/search`
- Desktop associate home: `/partner`
- Desktop associate requests: `/partner/requests`
- Desktop internal home: `/account`
- Desktop admin home: `/admin/dashboard`
- Desktop admin approvals: `/admin/approvals`
- Desktop invoices: `/invoices`

These routes are live now. They do not yet have a tutorial system or stable tour selectors.

## Router Files That Define The Live Surface

Primary route owners:
- `frontend/src/App.jsx`
- `frontend/src/mobile/MobileApp.jsx`
- `frontend/src/mobile/routing.js`
- `frontend/src/utils/rbac.js`

Demo-only helpers already present:
- `frontend/src/config/featureFlags.js`
- `frontend/src/components/DemoMarker.jsx`
- `frontend/src/components/AssociateDemoPromo.jsx`
- `frontend/src/components/layout/AppShell.jsx`
- `frontend/src/mobile/MobileLayout.jsx`

## Public And Auth Entry Routes

Defined in `frontend/src/App.jsx`:
- `/login`
- `/partner/request-access`
- `/partner/request-access/sent`
- `/partner/verify`
- `/invite/accept`
- `/m/*`
- `/mobile` -> redirects to `/m/home`
- `/mobile/assignments/:id` -> redirects to `/m/assignments/:id`

Why this matters for the tutorial:
- First-run onboarding for demo users should most likely trigger after login, not on the public login page itself.
- The login page already has demo credential shortcuts in demo mode, so the tutorial should start on the first authenticated screen.

## Mobile Routes Live In Demo Right Now

Defined in `frontend/src/mobile/MobileApp.jsx`.

### Mobile Home
- Route: `/m/home`
- File: `frontend/src/mobile/screens/HomeScreen.jsx`
- Shell: `frontend/src/mobile/MobileLayout.jsx`
- Notes:
  - best first-run entry point for the mobile tutorial
  - already contains role-aware quick cards
  - already shows `AssociateDemoPromo` for associate mode

### Mobile Assignments List
- Route: `/m/assignments`
- File: `frontend/src/mobile/screens/AssignmentsScreen.jsx`
- Notes:
  - useful for queue orientation
  - useful for field-user tutorial path

### Mobile Assignment Detail
- Route: `/m/assignments/:id`
- File: `frontend/src/mobile/screens/AssignmentDetailScreen.jsx`
- Notes:
  - already contains detail, documents, timeline, and messaging/comment flows
  - strongest screen for evidence, communication, and next-action coaching

### Mobile Uploads For Specific Assignment
- Route: `/m/assignments/:id/uploads`
- File: `frontend/src/mobile/screens/UploadsScreen.jsx`
- Notes:
  - best place to explain checklist completeness and evidence discipline
  - strong candidate for help callouts and next-step CTA

### Mobile Upload Queue
- Route: `/m/uploads`
- File: `frontend/src/mobile/screens/UploadsScreen.jsx`
- Notes:
  - list mode when no assignment id is supplied
  - good for tutorial step that says "find work missing documents"

### Mobile Draft Creation
- Route: `/m/create`
- File: `frontend/src/mobile/screens/CreateAssignmentScreen.jsx`
- Notes:
  - existing 3-step wizard
  - strongest target for staff draft tutorial
  - has sticky footer actions already, so tutorial work must respect that layout

### Mobile Associate Request Composer
- Route: `/m/request/new`
- File: `frontend/src/mobile/screens/AssociateRequestComposerScreen.jsx`
- Notes:
  - best tutorial target for external associate path
  - should be treated as the associate-safe intake flow

### Mobile Approvals
- Route: `/m/approvals`
- File: `frontend/src/mobile/screens/ApprovalsScreen.jsx`
- Notes:
  - strongest target for admin or ops tutorial
  - already has queue, status filters, and bottom-sheet detail

### Mobile Invoices
- Route: `/m/invoices`
- File: `frontend/src/mobile/screens/InvoicesScreen.jsx`
- Notes:
  - strongest target for admin finance/payment confirmation tutorial

### Mobile Notifications
- Route: `/m/notifications`
- File: `frontend/src/mobile/screens/NotificationsScreen.jsx`

### Mobile Profile
- Route: `/m/profile`
- File: `frontend/src/mobile/screens/ProfileScreen.jsx`

### Mobile Search
- Route: `/m/search`
- File: `frontend/src/mobile/screens/SearchScreen.jsx`
- Notes:
  - useful for employee or field tutorial step: "find the assignment quickly"

## Desktop Internal Routes Live In Demo Right Now

Defined in `frontend/src/App.jsx` under employee-area routing.

### Staff Home
- Route: `/account`
- File: `frontend/src/pages/Account.jsx`
- Notes:
  - best desktop home for employee or field tutorial entry

### Assignments
- Route: `/assignments`
- File: `frontend/src/pages/Assignments.jsx`

### New Assignment
- Route: `/assignments/new`
- File: `frontend/src/pages/NewAssignment.jsx`

### Assignment Detail
- Route: `/assignments/:id`
- File: `frontend/src/pages/AssignmentDetail.jsx`

### Notifications
- Route: `/notifications`
- File: `frontend/src/pages/NotificationsPage.jsx`

### Invoices
- Route: `/invoices`
- File: `frontend/src/pages/InvoicesPage.jsx`

### Admin Dashboard
- Route: `/admin/dashboard`
- File: `frontend/src/pages/admin/AdminDashboard.jsx`
- Notes:
  - best desktop admin tutorial entry point

### Admin Approvals
- Route: `/admin/approvals`
- File: `frontend/src/pages/admin/AdminApprovals.jsx`

### Admin Open Queue
- Route: `/admin/open-queue`
- File: `frontend/src/pages/admin/AdminOpenQueue.jsx`

### Admin Analytics
- Route: `/admin/analytics`
- File: `frontend/src/pages/admin/AdminAnalytics.jsx`

Other live admin routes also exist, but they are lower priority for a first 5-minute demo tutorial:
- `/admin/workload`
- `/admin/activity`
- `/admin/backups`
- `/admin/personnel`
- `/admin/partners/:id`
- `/admin/masterdata`
- `/admin/company`
- `/admin/notification-deliveries`
- `/admin/attendance`
- `/admin/partner-requests`
- `/admin/billing-monitor`
- `/admin/payroll`
- `/admin/payroll/runs/:id`
- `/admin/payroll/employees`
- `/admin/payroll/reports`
- `/admin/support`
- `/admin/system-config`

## Desktop Associate Routes Live In Demo Right Now

Defined in `frontend/src/App.jsx` under partner-area routing.

### Associate Home
- Route: `/partner`
- File: `frontend/src/pages/partner/PartnerHome.jsx`
- Notes:
  - best desktop associate tutorial entry point

### Associate Draft Creation
- Route: `/partner/assignments/new`
- File: `frontend/src/pages/NewAssignment.jsx`
- Notes:
  - capability-gated

### Associate Requests List
- Route: `/partner/requests`
- File: `frontend/src/pages/partner/PartnerRequests.jsx`

### Associate New Request
- Route: `/partner/requests/new`
- File: `frontend/src/pages/partner/PartnerRequestNew.jsx`

### Associate Request Detail
- Route: `/partner/requests/:id`
- File: `frontend/src/pages/partner/PartnerRequestDetail.jsx`

### Associate Payments
- Route: `/partner/payments`
- File: `frontend/src/pages/partner/PartnerPayments.jsx`

### Associate Notifications
- Route: `/partner/notifications`
- File: `frontend/src/pages/partner/PartnerNotifications.jsx`

### Associate Profile
- Route: `/partner/profile`
- File: `frontend/src/pages/partner/PartnerProfile.jsx`

### Associate Help
- Route: `/partner/help`
- File: `frontend/src/pages/partner/PartnerHelp.jsx`
- Notes:
  - possible reuse point for demo help/glossary content

## Current Desktop To Mobile Auto-Routing

Defined in `frontend/src/mobile/routing.js`.

Current automatic mappings:
- `/` -> `/m/home`
- `/account` -> `/m/home`
- `/partner` -> `/m/home`
- `/admin/dashboard` -> `/m/home`
- `/assignments` -> `/m/assignments`
- `/admin/open-queue` -> `/m/assignments`
- `/partner/requests` -> `/m/assignments`
- `/partner/requests/new` -> `/m/request/new`
- `/assignments/new` -> `/m/create`
- `/partner/assignments/new` -> `/m/create`
- `/notifications` -> `/m/notifications`
- `/admin/approvals` -> `/m/approvals`
- `/invoices` -> `/m/invoices`
- `/assignments/:id` -> `/m/assignments/:id`

Public routes intentionally excluded from auto-mobile redirect:
- `/login`
- `/m/*`
- `/partner/request-access*`
- `/partner/verify*`
- `/invite/accept*`

Why this matters:
- The tutorial can assume mobile users will often end up on `/m/*` automatically.
- Desktop-only tutorial steps should not rely on mobile redirect behavior.

## Existing Demo-Specific UI Already In Place

### Global Demo Banner
- File: `frontend/src/components/DemoMarker.jsx`
- Mounted in:
  - `frontend/src/components/layout/AppShell.jsx`
  - `frontend/src/mobile/MobileLayout.jsx`
  - `frontend/src/components/Navbar.jsx`
  - public auth pages

### Associate Demo Promo
- File: `frontend/src/components/AssociateDemoPromo.jsx`
- Mounted in:
  - `frontend/src/pages/partner/PartnerHome.jsx`
  - `frontend/src/mobile/screens/HomeScreen.jsx`
- Behavior:
  - shown outside demo
  - hidden in demo

Why this matters:
- The codebase already accepts demo-only overlays and promo surfaces.
- A tutorial system should reuse this pattern instead of inventing a separate environment toggle.

## Best Tutorial Mount Points In The Current Code

High-confidence mounts:
- Global modal gate:
  - `frontend/src/mobile/MobileLayout.jsx`
  - `frontend/src/components/layout/AppShell.jsx`
- Mobile mission panel:
  - `frontend/src/mobile/screens/HomeScreen.jsx`
- Desktop associate mission panel:
  - `frontend/src/pages/partner/PartnerHome.jsx`
- Desktop staff mission panel:
  - `frontend/src/pages/Account.jsx`
- Desktop admin mission panel:
  - `frontend/src/pages/admin/AdminDashboard.jsx`
- Embedded help on draft creation:
  - `frontend/src/mobile/screens/CreateAssignmentScreen.jsx`
  - possibly also `frontend/src/pages/NewAssignment.jsx`
- Embedded help on uploads:
  - `frontend/src/mobile/screens/UploadsScreen.jsx`
- Embedded help on approvals:
  - `frontend/src/mobile/screens/ApprovalsScreen.jsx`
  - `frontend/src/pages/admin/AdminApprovals.jsx`
- Embedded help on invoices:
  - `frontend/src/mobile/screens/InvoicesScreen.jsx`
  - `frontend/src/pages/InvoicesPage.jsx`

## What Is Missing Today

The current demo does not yet have:
- a first-login onboarding modal
- a persistent mission checklist
- a dedicated demo help center or glossary route
- a JSON-driven tour engine
- stable `data-tour-id` selectors for guided steps
- a mobile persistent "what to click next" prompt

## Stable Selector Situation Right Now

Current status:
- there are many visible buttons and section titles
- there are no dedicated tutorial selectors yet
- Playwright can target text today, but a real tour engine should not depend on brittle text-only matching

Recommendation:
- add `data-tour-id` attributes to the exact UI targets used by the tutorial
- keep those ids stable and role-aware

Suggested first selector set:
- `demo-mission-panel`
- `demo-start-tour`
- `mobile-home-priority-queue`
- `mobile-create-step-1`
- `mobile-create-primary-submit`
- `mobile-uploads-progress`
- `mobile-uploads-form`
- `mobile-approval-queue`
- `mobile-invoices-list`
- `mobile-assignment-documents`
- `mobile-assignment-messages`
- `desktop-partner-mission-panel`
- `desktop-admin-mission-panel`

## Demo Data Surface Already Available

The demo reset path is deterministic today.

Primary files:
- `ops/demo_reset.sh`
- `backend/app/scripts/seed_e2e.py`

Current seeded guarantees already visible in the code:
- seeded demo users
- pending draft approval
- final document review approval
- payment confirmation approval
- invoice awaiting payment confirmation
- adjusted invoice example
- associate-partner interaction seed

This means tutorial work can start from the existing seeded dataset rather than requiring a new seed architecture immediately.
