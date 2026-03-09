# Demo Tutorial Spec

## Scope

This document defines the role-based guided tutorial content used by the Maulya demo and the shared tutorial engine.

Implementation files:
- `frontend/src/demo/tutorial/demoTutorialSteps.js`
- `frontend/src/demo/tutorial/DemoTutorialContext.jsx`
- `frontend/src/demo/tutorial/DemoOnboardingModal.jsx`
- `frontend/src/demo/tutorial/DemoMissionPanel.jsx`
- `frontend/src/demo/tutorial/DemoCoachmarkLayer.jsx`
- `frontend/src/demo/tutorial/DemoHelpCenter.jsx`
- `frontend/src/demo/tutorial/tutorialPolicy.js`

## Experience Goals

A first-time visitor should be able to:
- understand what Maulya is for in under one minute
- choose a role-specific workflow without guessing
- complete a guided loop through live routes and real seeded data
- reopen the help center or restart the tour without losing context

## Shared Step Format

Every tutorial step uses the same content structure:
- `title`
- `explanation`
- `whyItMatters`
- `actionText`
- `expectedResult`
- `route`
- `routePattern`
- `target`
- optional `autoAdvanceOnRoute`
- optional `routeSourceTarget`

## Stable Tour Anchors

Current minimum selector set:
- `demo-start-tour`
- `demo-mission-panel`
- `demo-mission-next`
- `mobile-home-quick-drafts`
- `mobile-home-quick-approvals`
- `mobile-home-quick-uploads`
- `mobile-associate-request-form`
- `mobile-associate-request-submit`
- `mobile-assignments-list`
- `mobile-assignment-summary`
- `mobile-assignment-status`
- `mobile-uploads-progress`
- `mobile-approvals-list`
- `mobile-invoices-list`
- `mobile-search-screen`
- `mobile-create-stepper`

## Associate Tour

Audience:
- External associate users

Duration:
- 5 minutes

Primary path:
- `/m/home`
- `/m/request/new`
- `/m/assignments`
- `/m/assignments/:id`
- `/m/assignments/:id/uploads`
- `/m/assignments/:id`

Narrative:
- structured intake
- safe draft or request submission
- visible queue tracking
- evidence discipline
- status visibility

Steps:

### 1. Welcome To Mobile Home
- What you are seeing: the mobile control surface for requests, uploads, and status movement.
- Why it matters: associates need one place to understand draft pressure and missing-file pressure.
- Do this now: review the mission panel and start from the guided workflow.
- Expected result: the user understands where to restart the tutorial and where queue pressure is visible.

### 2. Open The Associate Request Composer
- What you are seeing: the structured intake form for new associate requests.
- Why it matters: Maulya replaces informal intake with controlled, searchable request capture.
- Do this now: fill essential service, borrower, branch, and property details.
- Expected result: the request has enough context to move into a controlled draft or submission state.

### 3. Save Or Submit With Intent
- What you are seeing: explicit draft and submit actions inside the request composer.
- Why it matters: work-in-progress stays visible without polluting permanent records.
- Do this now: use Save Draft when details are incomplete, or Submit Request when the intake is ready.
- Expected result: the request becomes a tracked record instead of disappearing into ad-hoc communication.

### 4. Track Active Requests
- What you are seeing: the request and assignment queue.
- Why it matters: associates need a single list showing whether a request is draft, in review, or waiting on evidence.
- Do this now: open the most relevant request from the queue.
- Expected result: the user reaches a single request detail view with operational context.

### 5. Read The Request Status In Context
- What you are seeing: request summary, status chip, customer context, and next-action signals.
- Why it matters: status only matters when it explains whether the request is moving or blocked.
- Do this now: review the summary and status before moving into uploads.
- Expected result: the user understands what should happen next for this request.

### 6. Complete Evidence And Checklist Work
- What you are seeing: upload slots, checklist progress, and missing-item visibility.
- Why it matters: evidence discipline reduces approval churn and downstream follow-up noise.
- Do this now: review missing items and upload one supporting file.
- Expected result: checklist progress improves and the request becomes easier to review cleanly.

### 7. Finish The Associate Loop
- What you are seeing: the request detail state after intake and evidence.
- Why it matters: Maulya keeps the entire request visible through review and follow-up instead of losing accountability after submission.
- Do this now: return to request detail and confirm where status and next action appear.
- Expected result: the user can intake, upload, and track a request through the live associate flow.

## Admin / Ops Tour

Audience:
- Admin and operations users

Duration:
- 6 minutes

Primary path:
- `/m/home`
- `/m/approvals`
- `/m/invoices`

Narrative:
- control surfaces
- approvals discipline
- payment confirmation

Steps:
- Start from the mobile control surface.
- Review approval pressure in the inbox.
- Track payment confirmation and invoice control.

## Field / Employee Tour

Audience:
- Field and employee users

Duration:
- 5 minutes

Primary path:
- `/m/home`
- `/m/search`
- `/m/create`

Narrative:
- queue-first execution
- fast retrieval
- structured draft creation

Steps:
- Start from My Day.
- Find work fast via search.
- Open the draft wizard and understand controlled intake.

## Help Center Content

Help center routes:
- desktop: `/help/demo` and `/help/tutorial`
- mobile: `/m/help/demo` and `/m/help/tutorial`

Help center sections:
- Quick start by role
- Workflow map
- Glossary

Core glossary terms:
- Draft
- Evidence
- Approval
- Payment confirmation
- Closure
- Mission panel

## Data Assumptions

Tutorials rely on deterministic demo seed data.

Expected seed guarantees:
- at least one pending approval
- at least one assignment or request with missing documents
- at least one invoice awaiting payment confirmation
- at least one completed example

Seed/reset support already exists through:
- `ops/demo_reset.sh`
- `backend/app/scripts/seed_e2e.py`

## Verification Targets

Minimum regression expectations:
- first-login prompt opens in the correct environment mode
- associate flow starts from the modal
- mission panel progress updates
- help center is reachable from the launcher and mission panel
- step route transitions work through the mobile surface
