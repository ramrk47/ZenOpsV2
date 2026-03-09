# Demo Tutorial Implementation Plan

This plan translates the demo tutorial brief into the current Maulya V1 codebase.

Scope:
- Repo/worktree: `ZenOpsV2/.worktrees/v1-repogen-deploy`
- Branch: `codex/v1-pilot-deploy-v1only`
- App scope: `legacy/v1`
- Environment gate: demo only

Related route inventory:
- `docs/DEMO_LIVE_PATHS_AND_TUTORIAL_SURFACES.md`

## Objectives

The tutorial system should make the demo usable by a first-time visitor in one session.

Primary outcomes:
- user understands what to do next without guessing
- user completes one realistic workflow in 3 to 5 minutes
- user understands the difference between draft work, evidence completeness, approvals, and payment flow
- user can resume where they left off
- tutorial is demo-only and does not leak into pilot or production behavior

## Design Principles

Implementation should follow these rules:
- demo-only gate everywhere through `isDemoMode()`
- workflow-first, not feature-first
- role-aware copy and step order
- selectors stable enough for both coach marks and Playwright
- local persistence first, backend persistence only if needed later
- no route or layout rewrites unless there is a hard blocker

## Recommended Delivery Shape

Deliver the tutorial system as six pieces:
- `DEMO_TUTORIAL_SPEC.md`
- tutorial step definitions module
- onboarding modal
- mission panel
- help center or glossary page
- minimal Playwright regression spec

## Proposed File Additions

### Documentation
- `docs/DEMO_TUTORIAL_SPEC.md`
  - final role-based scripts
  - professional wording for every step
  - completion criteria for each path

### Frontend Core
- `frontend/src/demo/tutorial/demoTutorialSteps.js`
  - JSON-like step definitions
  - one exported flow per role
- `frontend/src/demo/tutorial/tutorialStorage.js`
  - localStorage keys and helpers
- `frontend/src/demo/tutorial/useDemoTutorial.js`
  - current role, current flow, resume, next, back, skip, reset
- `frontend/src/demo/tutorial/DemoOnboardingModal.jsx`
- `frontend/src/demo/tutorial/DemoMissionPanel.jsx`
- `frontend/src/demo/tutorial/DemoCoachmarkLayer.jsx`
- `frontend/src/demo/tutorial/DemoHelpCenter.jsx`
- `frontend/src/demo/tutorial/demoGlossary.js`

### Routing
- add a desktop help route for authenticated users
- add a mobile help route alias

Recommended route targets:
- `/help/demo`
- `/m/help/demo`

## Existing Files To Modify

### Global Demo Shell Mounts
- `frontend/src/components/layout/AppShell.jsx`
- `frontend/src/mobile/MobileLayout.jsx`

Planned changes:
- mount `DemoOnboardingModal`
- mount `DemoCoachmarkLayer`
- mount a lightweight tutorial-resume trigger
- do not show outside demo mode

### Home Surfaces
- `frontend/src/mobile/screens/HomeScreen.jsx`
- `frontend/src/pages/partner/PartnerHome.jsx`
- `frontend/src/pages/Account.jsx`
- `frontend/src/pages/admin/AdminDashboard.jsx`

Planned changes:
- mount `DemoMissionPanel`
- role-aware copy and next-step CTA
- show progress state and jump-to-step behavior

### Embedded Help Callout Targets
- `frontend/src/mobile/screens/CreateAssignmentScreen.jsx`
- `frontend/src/mobile/screens/UploadsScreen.jsx`
- `frontend/src/mobile/screens/ApprovalsScreen.jsx`
- `frontend/src/mobile/screens/InvoicesScreen.jsx`
- `frontend/src/mobile/screens/AssignmentDetailScreen.jsx`
- optionally desktop equivalents:
  - `frontend/src/pages/NewAssignment.jsx`
  - `frontend/src/pages/admin/AdminApprovals.jsx`
  - `frontend/src/pages/InvoicesPage.jsx`

Planned changes:
- add compact helper blocks or `InfoTip` callouts
- add stable `data-tour-id` anchors
- add small "Need help?" links to `/help/demo`

### Routing Files
- `frontend/src/App.jsx`
- `frontend/src/mobile/MobileApp.jsx`

Planned changes:
- register `/help/demo`
- register `/m/help/demo`
- ensure all authenticated roles can reach the help center

## Tour Engine Model

Use a JSON-driven model with one flow per role.

Each step should contain:
- `id`
- `role`
- `title`
- `explanation`
- `whyItMatters`
- `actionText`
- `expectedResult`
- `route`
- `target`
- `placement`
- `ctaLabel`
- `completionType`
- `completionValue`

Example completion types:
- `route-visible`
- `element-visible`
- `element-clicked`
- `local-action`
- `manual-continue`

Reasonable first version:
- do not block on deep event instrumentation
- allow manual next/back while validating route and selector presence
- layer event-driven completion later

## Local Persistence Strategy

Keep progress local for phase one.

Recommended keys:
- `maulya.demo.tutorial.state.v1`
- `maulya.demo.tutorial.dismissed.v1`
- `maulya.demo.tutorial.role.v1`

Store:
- selected role flow
- current step index
- completed step ids
- last seen route
- dismissed or explored state

Reasoning:
- cheap to implement
- no backend schema change
- no collision with pilot if namespaced properly

## Role Paths To Implement First

## 1. Associate Flow

Priority: highest

Primary route path:
- `/m/home`
- `/m/request/new`
- `/m/assignments`
- `/m/assignments/:id`
- `/m/assignments/:id/uploads`

Goal:
- show that associate intake is structured and traceable

Recommended steps:
1. Mobile home orientation
2. Open associate request composer
3. Complete safe intake basics
4. Open request detail
5. Open uploads/checklist area
6. Understand status tracking
7. Finish with next actions

Primary files:
- `frontend/src/mobile/screens/HomeScreen.jsx`
- `frontend/src/mobile/screens/AssociateRequestComposerScreen.jsx`
- `frontend/src/mobile/screens/AssignmentDetailScreen.jsx`
- `frontend/src/mobile/screens/UploadsScreen.jsx`

## 2. Admin Or Ops Flow

Priority: second

Primary route path:
- `/m/home`
- `/m/approvals`
- `/m/assignments/:id`
- `/m/invoices`

Goal:
- show governance, review, and payment control

Recommended steps:
1. Home dashboard orientation
2. Open approvals queue
3. Review a pending draft approval
4. Review assignment evidence or missing documents
5. Open invoices list
6. Understand payment confirmation state
7. Finish with control-loop summary

Primary files:
- `frontend/src/mobile/screens/HomeScreen.jsx`
- `frontend/src/mobile/screens/ApprovalsScreen.jsx`
- `frontend/src/mobile/screens/AssignmentDetailScreen.jsx`
- `frontend/src/mobile/screens/InvoicesScreen.jsx`

## 3. Employee Or Field Flow

Priority: third

Primary route path:
- `/m/home`
- `/m/search`
- `/m/assignments`
- `/m/assignments/:id/uploads`
- `/m/create`

Goal:
- show fast execution from queue to evidence completion

Recommended steps:
1. My Day orientation
2. Find an assignment in search or queue
3. Open uploads or checklist
4. Understand blocked vs ready
5. Open draft creation wizard
6. Finish with queue discipline

Primary files:
- `frontend/src/mobile/screens/HomeScreen.jsx`
- `frontend/src/mobile/screens/SearchScreen.jsx`
- `frontend/src/mobile/screens/AssignmentsScreen.jsx`
- `frontend/src/mobile/screens/UploadsScreen.jsx`
- `frontend/src/mobile/screens/CreateAssignmentScreen.jsx`

## Onboarding Modal Behavior

Mount in:
- `frontend/src/components/layout/AppShell.jsx`
- `frontend/src/mobile/MobileLayout.jsx`

Show only when all are true:
- demo mode is on
- user is authenticated
- tutorial is not already completed or dismissed for the current role
- current route is not a public auth page

Modal actions:
- `Start 5-minute tour`
- `Explore on my own`
- `Reset tutorial`

Role detection inputs:
- current user
- capabilities
- existing helpers from `frontend/src/utils/rbac.js`

Recommended default flow selection:
- partner user -> associate flow
- admin or approve-capable user -> admin flow
- otherwise -> employee or field flow

## Mission Panel Design

Mount points:
- mobile: `frontend/src/mobile/screens/HomeScreen.jsx`
- desktop associate: `frontend/src/pages/partner/PartnerHome.jsx`
- desktop staff: `frontend/src/pages/Account.jsx`
- desktop admin: `frontend/src/pages/admin/AdminDashboard.jsx`

Content model:
- current tutorial name
- progress fraction
- next action text
- jump-to-step list
- restart action
- open glossary action

First version behavior:
- stateless rendering from tutorial storage hook
- click on next action navigates to required route and opens coach mark

## Embedded Help Scope

Required callouts:
- create draft assignment
- uploads and checklist
- approvals inbox
- invoice detail or invoice list
- assignment detail communication area

Recommended callout pattern:
- title
- one-paragraph explanation
- why it matters
- link to `/help/demo`

Reuse opportunities:
- `InfoTip`
- existing card components
- existing note or alert styles

## Mobile "What To Click Next" Footer

This is worth doing in phase two, not phase one.

Why:
- high value on mobile
- directly addresses confusion during the walkthrough
- but it touches already fragile footer and sticky-action behavior

Best implementation point:
- `frontend/src/mobile/MobileLayout.jsx` or `frontend/src/mobile/MobileTabs.jsx`

Constraint:
- must not overlap sticky create or approval footers
- must cooperate with existing `StickyFooter` usage in create and upload screens

Recommended approach:
- render only when no page-level `StickyFooter` is active
- or reserve bottom spacing through a shared shell-level CSS variable

## Stable Selector Plan

A real tutorial should not depend on visible text alone.

Add `data-tour-id` attributes to tutorial targets.

Recommended initial target list:
- `demo-start-tour`
- `demo-mission-panel`
- `demo-mission-next`
- `mobile-home-quick-drafts`
- `mobile-home-quick-approvals`
- `mobile-home-quick-uploads`
- `mobile-create-stepper`
- `mobile-create-service-line`
- `mobile-create-save`
- `mobile-associate-request-form`
- `mobile-uploads-progress`
- `mobile-uploads-submit`
- `mobile-approvals-list`
- `mobile-approvals-open-detail`
- `mobile-invoices-list`
- `mobile-assignment-documents`
- `mobile-assignment-messages`
- `mobile-assignment-comments`

## Seed And Fixture Strategy

Current deterministic seed path already exists:
- `ops/demo_reset.sh`
- `backend/app/scripts/seed_e2e.py`

Current visible guarantees from seed output and code:
- demo users exist
- pending draft approval exists
- final document review approval exists
- payment confirmation approval exists
- invoice awaiting payment confirmation exists
- adjusted invoice example exists
- partner interaction seed exists

Conclusion:
- phase one does not need a new seed architecture
- phase two may still benefit from explicit tutorial fixture tagging if selector-driven steps need guaranteed record names or ids

Recommended phase-two improvement:
- add tutorial-friendly labels or codes in the seed
- example prefixes:
  - `DEMO DRAFT APPROVAL`
  - `DEMO PAYMENT CONFIRMATION`
  - `DEMO MISSING DOCS`

## Help Center Plan

Route targets:
- desktop: `/help/demo`
- mobile alias: `/m/help/demo`

Content sections:
- quick start by role
- glossary
- workflow map: draft -> evidence -> approvals -> invoice -> closure
- short explanations for:
  - draft assignment
  - evidence completeness
  - readiness
  - approval discipline
  - payment confirmation
  - report release

Potential reuse point:
- the existing partner help surface at `/partner/help`

Recommended implementation choice:
- create a dedicated `DemoHelpCenter` component and render it in both desktop and mobile wrappers
- do not overload `PartnerHelp` with demo-only logic unless reuse is very high

## Playwright Test Plan

Use the existing Playwright stack in `frontend/playwright`.

Add:
- `frontend/playwright/tests/demo_tutorial.spec.ts`

Minimum coverage:
- login to demo with seeded user
- confirm onboarding modal appears in demo mode
- start tutorial
- advance at least three steps
- verify progress state updates

Test requirements:
- stable `data-tour-id` selectors
- deterministic demo login credentials
- route assertions rather than only text assertions

## Suggested Implementation Order

## Phase 1: Documentation And Data Contract
- write `docs/DEMO_TUTORIAL_SPEC.md`
- define flows and step ids
- confirm selector list and seeded data assumptions

## Phase 2: Core Tutorial Infrastructure
- add storage helpers
- add hook for progress and role selection
- add onboarding modal
- add mission panel

## Phase 3: Guided Step Integration
- add coach mark layer
- wire routes and element targets
- add embedded help callouts

## Phase 4: Help Center And Glossary
- add `/help/demo`
- add `/m/help/demo`
- wire links from mission panel and helper notes

## Phase 5: QA And Polish
- add Playwright spec
- verify resume behavior
- verify no tutorial UI leaks into pilot
- verify mobile sticky elements do not overlap tutorial prompts

## Acceptance Criteria

Minimum acceptable implementation:
- demo-only gate works
- first login surfaces onboarding modal
- role-aware flow is selected automatically
- mission panel shows progress and next step
- at least one full associate flow can be followed end to end
- at least one admin flow can be followed through approvals and invoices
- `/help/demo` exists and explains key concepts in plain language
- Playwright test passes for tutorial start and multi-step advance

## Risks And Constraints

### 1. Sticky Footer Overlap On Mobile
This is already a known UI risk in the current mobile build.
Any tutorial footer or coach mark must respect screen-level sticky actions.

### 2. Missing Stable Selectors
The current UI is tourable manually, but not robustly enough for a long-lived coach-mark system.
Selector work is mandatory.

### 3. Role Surface Fragmentation
Desktop and mobile use different route shells and different home pages.
The shared tutorial logic should live in a demo-specific hook, not inside one screen.

### 4. Help Route Placement
`/help/demo` needs careful routing so all authenticated roles can reach it cleanly.
The simplest solution is a dedicated authenticated route plus a mobile alias.

## Recommended First Cut

If work needs to start fast, build this slice first:
- `docs/DEMO_TUTORIAL_SPEC.md`
- `demoTutorialSteps.js`
- `tutorialStorage.js`
- `useDemoTutorial.js`
- `DemoOnboardingModal.jsx`
- `DemoMissionPanel.jsx`
- mission panel mounted on:
  - `HomeScreen.jsx`
  - `PartnerHome.jsx`
  - `AdminDashboard.jsx`
- one embedded helper in:
  - `CreateAssignmentScreen.jsx`
  - `UploadsScreen.jsx`
  - `ApprovalsScreen.jsx`
- one Playwright test for tutorial start and next-next-next flow

That gets the highest-value demo guidance in place without rewriting the app.
