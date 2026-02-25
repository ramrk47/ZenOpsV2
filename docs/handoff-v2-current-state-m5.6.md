# ZenOps Current State Handoff (V2 Through M5.6, with V1 Bridge Context)

Last updated: 2026-02-25 (US-local session)

## Purpose

This handoff is the "single briefing" for the current ZenOps state across:

- V2 (current platform work, control plane, Repogen spine/factory)
- V1 (legacy operational engine, now co-located as a subtree under `legacy/v1`)

It explains not just what each milestone shipped, but why it was done in that order, what problem it solved, and where V1 was involved (or intentionally not involved).

This is written for the next engineer/operator who needs to understand the system quickly without replaying all milestone chats.

## Executive Summary (What ZenOps is right now)

ZenOps currently operates as a deliberate two-system setup:

- **V2** is the forward platform and control/billing truth, with Repogen data/factory workflows now built through **M5.6**.
- **V1** is the still-active legacy operations engine (staff/admin UX and legacy operational flows) and is now imported into this repo as a **subtree bridge** for coordination, not as a merged runtime/data platform.

The most important architectural choices that define the current state:

- **Billing truth moved into V2** (credits, reservations, usage, service invoices, subscriptions, payment rails).
- **V1 and V2 remain hard-separated** at DB/runtime/env level.
- **Repogen in V2 was built in layers**:
  - M5.3 pack/job spine
  - M5.4 deterministic work-order data spine (rules/readiness/export)
  - M5.5 factory bridge + manual release billing gates
  - M5.6 evidence intelligence (profiles/checklists/field-evidence links/OCR placeholders)
- **No template rendering and no OCR extraction engine yet** (intentionally deferred).

## Source-of-Truth Documents (Read These First)

The following repo documents are the authoritative references behind this handoff:

- `/Users/dr.156/ZenOpsV2/docs/implementation-log.md`
- `/Users/dr.156/ZenOpsV2/docs/changelog.md`
- `/Users/dr.156/ZenOpsV2/docs/BOUNDARIES_V1_V2.md`
- `/Users/dr.156/ZenOpsV2/docs/handoff-m5.2-to-m5.3-takeover.md`
- `/Users/dr.156/ZenOpsV2/docs/handoff-m5.3-monorepo-bridge.md`
- `/Users/dr.156/ZenOpsV2/docs/REPOGEN_SPINE_M5_3.md`
- `/Users/dr.156/ZenOpsV2/docs/REPOGEN_SPINE_V1.md`
- `/Users/dr.156/ZenOpsV2/docs/REPOGEN_FACTORY_FLOW_M5_5.md`
- `/Users/dr.156/ZenOpsV2/docs/REPOGEN_EVIDENCE_INTELLIGENCE_M5_6.md`
- `/Users/dr.156/ZenOpsV2/docs/ZENOPS_REPORT_GENERATION_REQUIREMENTS.md`

## Repo Layout and Runtime Boundaries (Current)

### V2 (primary active platform work)

Location:

- `/Users/dr.156/ZenOpsV2/apps/*`

Key apps:

- `apps/api` (NestJS/Fastify, `/v1/*`)
- `apps/worker` (BullMQ processors)
- `apps/web` (tenant/internal plane)
- `apps/studio` (control plane)
- `apps/portal` (external/channel plane)

Shared packages include:

- `packages/db`, `packages/contracts`, `packages/config`, `packages/ui`, etc.

### V1 (legacy operational engine, bridge-imported)

Location:

- `/Users/dr.156/ZenOpsV2/legacy/v1`

Important note:

- This is a **subtree import for coordination**, not a runtime merge.
- V1 keeps its own compose files, env files, DB schema/migrations, and operational flows.

### Non-negotiable V1/V2 boundary rules (still in force)

From `/Users/dr.156/ZenOpsV2/docs/BOUNDARIES_V1_V2.md`:

- Separate DBs
- Separate compose stacks
- Separate env files
- No cross-DB SQL writes
- Integration only via HTTP/events
- V2 owns billing truth and control-plane decisions

## How to Read the Milestone Story

The milestone progression is easiest to understand as five phases:

1. **Foundation + Assignment Spine (pre-M4 / M1-M3)**
2. **Operational hardening and deployability (M4.1-M4.6.x)**
3. **Billing truth migration into V2 (M4.7-M5.2)**
4. **Monorepo bridge and Repogen foundation (M5.3-M5.4)**
5. **Repogen factory flow and evidence intelligence (M5.5-M5.6)**

The key pattern throughout was: build deterministic spines first, then add operator surfaces, then automate, then tighten safety gates.

## Milestone Timeline and Rationale (Why Each "M" Happened)

## Phase A: V2 Inception to Early Spine (Pre-M4 / M1-M3)

This phase is represented in current repo history by:

- `e07afad` (`chore: scaffold v2 foundation`)
- tag `v2-milestone-assignment-spine`
- tag `v2-m3-billable-finalize`

Detailed breakdown is captured in `/Users/dr.156/ZenOpsV2/docs/implementation-log.md` sections:

- Foundation scaffold
- DB/RLS/Prisma
- API + Worker workflow spine
- Frontend surfaces
- Single-tenant launch gating
- Document registry + data bundle
- Smoke + dev hardening

### What we did

- Built the V2 monorepo (Turborepo + pnpm) with `api`, `worker`, `web`, `studio`, `portal`.
- Established multi-file Prisma schema + role-scoped RLS posture.
- Added core workflow primitives (assignments/report requests/report jobs).
- Added transaction-scoped tenant context and strict RLS helper functions.
- Added document registry + report data bundle infrastructure.
- Added single-tenant launch gating to keep rollout controlled.
- Hardened local dev workflow for V1 coexistence (port overrides, infra-only compose).

### Why we did it

- To avoid rebuilding V1 monolith patterns in V2.
- To make tenant isolation and control-plane boundaries foundational (not retrofitted).
- To support future report-generation and billing flows with deterministic storage/input models.
- To keep launch risk low by supporting single-tenant mode first while preserving multi-tenant architecture.

### Why this mattered later

- Repogen (M5.3+) depends directly on the data-bundle/document spine and worker/idempotency patterns built here.
- Billing (M4.7+) depends on the control/data plane separation and RLS discipline established here.

### V1 relevance in this phase

- V1 remained the active operational system.
- V2 was being built as a future-ready platform without breaking V1 operations.

## M4.1: Hardening + Webhook Security + Idempotency Baseline

Ref: `/Users/dr.156/ZenOpsV2/docs/implementation-log.md` timeline (`M4.1`), tag `m4.1`.

### What we did

- Stabilized the communications spine.
- Hardened webhook security and deduplication/idempotency behavior.
- Improved notification-flow reliability groundwork.

### Why we did it

- Provider/webhook paths are high-noise and high-risk for duplicate processing.
- Without idempotency first, later provider integrations (M4.3) and operator actions would be fragile.

### Why this mattered later

- M4.3 provider integrations and M5.x billing/payment webhooks reuse the same defensive posture.

### V1 relevance

- None directly in code ownership at this stage; this was V2 hardening to prepare for future integration.

## M4.2: People Directory + Comms Routing

Refs:

- `/Users/dr.156/ZenOpsV2/docs/handoff-m4.2-takeover.md`
- `/Users/dr.156/ZenOpsV2/docs/implementation-log.md` timeline (`M4.2`)

### What we did

- Introduced people/attendance/payroll-related enum and model groundwork.
- Added routing tables and role/team communication routing foundations.
- Expanded employee/payroll-related API/UI surfaces.

### Why we did it

- Operational systems need people/role routing before advanced workflows become realistic.
- This created the "who does what" layer necessary for tasking, notifications, and assignment ops.

### Why this mattered later

- M4.3 capability RBAC, M4.6 task assignment, and Studio/ops control surfaces all depend on structured people and role models.

### V1 relevance

- V1 still handled production operations, but V2 needed its own internal operating model rather than inheriting V1 assumptions.

## M4.3: Provider Integrations + RBAC Hardening

Refs:

- `/Users/dr.156/ZenOpsV2/docs/implementation-log.md` (Detailed M4.3 record)
- `/Users/dr.156/ZenOpsV2/docs/changelog.md` (2026-02-12)

### What we did

- Formalized capability-based RBAC in V2 auth/guards.
- Added provider-ready worker adapters:
  - Mailgun (email)
  - Twilio (WhatsApp)
- Expanded webhook routes and validation controls.
- Added NOOP-safe provider defaults and demo script support.

### Why we did it

- We needed "real provider pathways" without forcing production credentials during development.
- Capability RBAC was necessary to avoid over-permissioned internal operator flows as more admin/control features were added.

### Why this mattered later

- Billing control plane (M4.7+) and Repogen operator/factory actions (M5.4+) rely on strict RBAC and auditable administrative surfaces.

### V1 relevance

- This milestone prepared V2 to support production-grade notification/ops behavior, which helps future migration off V1 operational messaging paths.

## M4.4: Mobile Docs + Manual WhatsApp + Ops Monitor

Refs:

- `/Users/dr.156/ZenOpsV2/docs/implementation-log.md` (Detailed M4.4 record)
- `/Users/dr.156/ZenOpsV2/docs/changelog.md`

### What we did

- Expanded document metadata (source/classification/sensitivity/capture info).
- Added mobile-friendly upload and metadata tagging flows in V2 web UI.
- Added manual WhatsApp month-1 operational APIs and Studio controls.
- Added Studio ops monitor API/UI for operational visibility.

### Why we did it

- Field operations were bottlenecked on practical document intake, not just backend schemas.
- A manual WhatsApp path was the fastest operationally safe rollout while preserving auditability.
- Studio needed a single view of operational signal health to support real usage.

### Why this mattered later

- Repogen (M5.3+) and evidence intelligence (M5.6) depend on rich document metadata and field capture discipline.
- Manual, auditable ops controls set the pattern later used in manual deliverables release (M5.5).

### V1 relevance

- V1 remained in production; V2 was building a stronger field-intake/evidence model that would later support migration and coexistence.

## M4.5: Deploy + Ops Hardening

Refs:

- `/Users/dr.156/ZenOpsV2/docs/deploy-runbook-m4.5.md`
- `/Users/dr.156/ZenOpsV2/docs/implementation-log.md` (Detailed M4.5 record)
- `/Users/dr.156/ZenOpsV2/docs/changelog.md`

### What we did

- Added a production-like VPS deploy stack with Traefik routing and TLS.
- Added ops scripts for backup/restore/pre-migrate backup/off-hours worker downshift.
- Added cron examples and runbook documentation.
- Formalized deploy posture and operational checks.

### Why we did it

- Feature work without deploy/backup discipline creates operational fragility.
- The system needed a reproducible deploy/rollback/backup story before expanding billing and control-plane responsibilities.

### Why this mattered later

- Billing and Repogen milestones increased operational risk; M4.5 ensured the platform could be operated safely.
- Off-hours downshift pattern informed later cost-aware worker operations.

### V1 relevance

- V1 was still the business-critical system, so V2 deployment hardening had to be conservative and ops-friendly.

## M4.6: Assignment Ops Factory + Master Data Spine

Refs:

- `/Users/dr.156/ZenOpsV2/docs/implementation-log.md` (Detailed M4.6 record)
- `/Users/dr.156/ZenOpsV2/docs/changelog.md`
- `/Users/dr.156/ZenOpsV2/docs/m4.6-smoke-checklist.md`

### What we did

- Built assignment lifecycle transitions + status history.
- Added task system (API + worker + UI wiring).
- Added master-data CRUD for banks/branches/client orgs/contacts/properties/channels.
- Added channel request intake/review flow and acceptance -> assignment creation behavior.
- Added analytics fallback endpoint with zero-safe responses.
- Extended RLS and seeds for new ops/master tables.

### Why we did it

- V2 needed a deterministic operations factory backbone before billing and Repogen could be attached safely.
- Assignment lifecycle, tasking, and channel intake are the operational "spine" for real work.
- Normalized master data reduces future report-generation ambiguity and data-entry churn.

### Why this mattered later

- Billing reserve/consume gates (M4.7+) need assignment/channel lifecycle hooks.
- Repogen work orders and report packs later piggyback on assignment-linked workflows and evidence discipline.

### V1 relevance

- V1 still handled live operational throughput, but M4.6 established the V2 replacement path with structured assignment ops.

## M4.6.1: V1/V2 Segregation + Port Identity + Control/Data Plane Boundaries

Refs:

- `/Users/dr.156/ZenOpsV2/docs/implementation-log.md` (Detailed M4.6.1 record)
- `/Users/dr.156/ZenOpsV2/docs/changelog.md`
- `/Users/dr.156/ZenOpsV2/docs/V1_V2_SEGREGATION_REPORT.md`
- `/Users/dr.156/ZenOpsV2/docs/CONTROL_PLANE_BOUNDARIES.md`

### What we did

- Added V2 identity endpoint `GET /v1/meta`.
- Reserved V2 control-plane namespace (`/v1/control/*`) with RBAC-protected placeholders.
- Added port detection and API target verification scripts to avoid running demos against the wrong app.
- Added matching V1 `/v1/meta` endpoint (at the time in the separate V1 repo) for cross-system identity checks.
- Wrote boundary docs clarifying V1 vs V2 responsibilities and hostnames.

### Why we did it

- Local and server environments increasingly had both V1 and V2 running; port collisions and wrong-target testing became a real risk.
- Control-plane namespace had to be reserved before billing features expanded.
- We needed explicit boundary doctrine before billing and Repogen touched cross-system workflows.

### Why this mattered later

- M4.7+ billing handshake and M5.3 subtree bridge depended on exact V1/V2 identity and boundary contracts.
- Demo/smoke scripts became safer and less error-prone.

### V1 relevance

- V1 got a `/v1/meta` identity endpoint specifically to make coexistence safe and observable.

## M4.6.2: Compose Port Flex + Build Graph Guard + Handoff Hygiene

Ref: `/Users/dr.156/ZenOpsV2/docs/implementation-log.md` (Detailed M4.6.2 record)

### What we did

- Parameterized compose host bind ports in production compose.
- Updated Turborepo `lint` task to depend on `^build`.
- Added takeover handoff docs to reduce context loss across sessions.

### Why we did it

- Side-by-side V1/V2 runs required configurable ports.
- Monorepo linting against stale generated surfaces was causing false negatives/confusion.
- Session handoffs became necessary as scope expanded beyond single milestones.

### Why this mattered later

- Repogen era (M5.x) work spans many layers; build-graph and handoff discipline prevented drift.

### V1 relevance

- Port-flex changes directly reduced V1/V2 local collision risk.

## M4.7: Billing Spine + V1 Handshake Enablement

Refs:

- `/Users/dr.156/ZenOpsV2/docs/changelog.md`
- `/Users/dr.156/ZenOpsV2/docs/implementation-log.md` (M4.7 summary)
- `/Users/dr.156/ZenOpsV2/docs/m4.7-dual-vps-launch-readiness.md`

### What we did

- Built V2 billing control-plane foundations:
  - billing accounts/policies
  - credits ledger/reservations
  - subscriptions/plans
  - service invoices and related audit/timeline components
- Added V2 billing APIs and status lookup by external account key.
- Wired domain hooks for billing behavior on channel acceptance/download gating.
- Extended RLS/seed files for billing tables.

### Why we did it

- Billing needed to move into V2 as the system of truth before broader workflow migration.
- V1 could not be cleanly retired or bridged into Repogen-era operations without a stable V2 billing spine.
- External account key lookup created the handshake path for V1 integration without DB coupling.

### Why this mattered later

- M4.8-M5.2 build on this spine (operator surfaces, hardening, payments, lifecycle automation).
- M5.5 deliverables release billing gates depend on this exact billing truth layer.

### V1 relevance

- This is the milestone where V1/V2 billing handshake enablement becomes a first-class concern.
- V1 begins consuming V2 billing truth over HTTP (not DB access).

## M4.8: Billing Operator Surfaces

Refs:

- `/Users/dr.156/ZenOpsV2/docs/changelog.md`
- `/Users/dr.156/ZenOpsV2/docs/implementation-log.md` (M4.8 summary)

### What we did

- Expanded Studio control-plane APIs for operators:
  - account status
  - tenant credit aggregate
  - reservations
  - billing timeline
  - reserve/consume/release controls
- Reworked `apps/studio` into a billing-first control screen with account picker, policy toggle, wallet cards, and action tables.

### Why we did it

- Billing truth without operator visibility/control is operationally unusable.
- Support/ops/finance needed a safe UI to inspect and correct billing state while V1 and V2 coexist.

### Why this mattered later

- M4.9 hardening and M5.x launch/productization rely on operators being able to see and intervene in billing state.
- M5.5 manual deliverables release uses the same philosophy: explicit operator visibility and controlled actions.

### V1 relevance

- V1 workflows could now be monitored against V2 billing state from Studio, improving confidence during phased migration.

## M4.9: Credits + Postpaid Billing Productization

Refs:

- `/Users/dr.156/ZenOpsV2/docs/changelog.md`
- `/Users/dr.156/ZenOpsV2/docs/implementation-log.md` (M4.9 summary)
- `/Users/dr.156/ZenOpsV2/docs/CREDIT_SYSTEM_RULEBOOK.md`

### What we did

- Hardened credit lifecycle invariants (balances, reservations, transitions, idempotency).
- Added operator override support with explicit adjustment/timeline tracking.
- Added `/v1/service-invoices/*` compatibility routes and idempotent issue/mark-paid behavior.
- Added temporary Studio admin token and control-plane rate limits for safer rollout.
- Added launch runbooks and smoke scripts.

### Why we did it

- Early billing spines are risky until lifecycle invariants are enforced and observable.
- V1 migration needed compatibility routes to avoid a disruptive cutover.
- Operator override paths were necessary for real-world launch edge cases while keeping audit trails.

### Why this mattered later

- M5.1/M5.2 payment rails and lifecycle automation depend on strict idempotency and invariants.
- M5.5 credit consumption at deliverables release relies on these semantics being correct.

### V1 relevance

- Compatibility routes and V2 billing visibility were built specifically to support V1-era workflows during transition.

## M5.0: Launchable Billing Workflow Wiring

Refs:

- `/Users/dr.156/ZenOpsV2/docs/changelog.md`
- `/Users/dr.156/ZenOpsV2/docs/implementation-log.md` (M5.0 summary)

### What we did

- Added billing reconciliation sweep endpoint for reserve/consume/release cleanup.
- Exposed reconciliation actions in Studio.
- Added minimal invoices lane in V2 web app (list/create/issue/mark paid).
- Exposed billing/invoice visibility in V2 portal with payment-proof metadata submission.

### Why we did it

- Real operations produce orphaned/lagged states; reconciliation is needed for safety and recoverability.
- Billing had to move from "backend correctness only" to operator-usable workflow surfaces across web/studio/portal.
- This closed the loop on credit vs postpaid operational paths before expanding payment rails.

### Why this mattered later

- M5.1/M5.2 could then add payment rails/subscription automation on top of a launchable operational billing flow.

### V1 relevance

- V1 remained live, but V2 had now become operationally credible enough to carry billing-control responsibilities.

## M5.1: Credits / Subscriptions / Postpaid Parity Groundwork

Primary ref: `/Users/dr.156/ZenOpsV2/docs/handoff-m5.2-to-m5.3-takeover.md` (M5.1 section)

### What we did

- Extended billing truth spine for subscription refill and webhook events.
- Expanded Studio billing UI for operator workflows:
  - billing mode controls
  - credit actions/visibility
  - invoices and subscriptions surfaces
- Added worker scheduling for subscription refill scans and credit reconciliation.

Representative M5.1 commit stack (from handoff):

- `cc509f7` `feat(db): extend subscription models for refill and webhook events`
- `490f597` `feat(rls): add subscription events to billing control policies`
- `773f47c` `feat(contracts): add m5.1 subscription, onboarding, and payment webhook routes`
- `ec3a910` `feat(api): add m5.1 subscriptions, onboarding, and webhook billing flows`
- `3637829` `feat(worker): schedule hourly subscription credit refills`
- `de769ce` `feat(ui): add credit enrollment guardrails in studio policy controls`
- `69dbaac` `test(m5.1): cover subscription refills and invoice payment idempotency`

### Why we did it

- Billing needed lifecycle automation (subscriptions/refills) before payment rails could be introduced safely.
- Postpaid and credits needed "operational parity" so rollout mode could change per account without product gaps.

### Why this mattered later

- M5.2 payment webhooks settle into these subscription/credit/service invoice paths.
- M5.5 billing gates at deliverables release rely on reservation/invoice references and stable lifecycle semantics.

### V1 relevance

- V1 billing handshake already depended on V2 billing truth; M5.1 made that truth more complete and launch-ready.

## M5.2: Payment Rails + Lifecycle Automation + Deploy Hardening

Primary ref: `/Users/dr.156/ZenOpsV2/docs/handoff-m5.2-to-m5.3-takeover.md` (M5.2 section)

### What we did

- Added payment rails scaffolding and settlement flows:
  - checkout/top-up endpoints
  - verified Stripe and Razorpay webhooks
- Added webhook signature verification + idempotent event ingestion.
- Added settlement translation into internal billing actions (topups, invoice payments).
- Expanded Studio payment/subscription operator surfaces.
- Hardened worker billing sweeps/refills.
- Hardened VPS deploy routing/middleware for payment/webhook flows.
- Expanded smoke coverage for payment + credit + invoice flows.

### Why we did it

- To move from billing bookkeeping to actual payment-integrated operations.
- To support both card/online settlement and postpaid invoice lifecycle in a controlled, auditable manner.
- To prepare V2 to be the financial control plane while V1 still handled legacy operations.

### Why this mattered later

- Repogen factory release gates (M5.5) need reliable `CREDIT` and `POSTPAID` semantics, including invoice paid state and reserved-credit consumption.

### V1 relevance

From the M5.2 handoff (separate V1 work, later subtree-imported):

- V1 billing handshake adapter to V2
- V1 emits billing events to V2 timeline
- V1 soft-gating for credit mode in commission approval flows
- V1 admin Billing Monitor page (monitor-only) showing V1 ops truth + V2 billing visibility

This V1 work was necessary to let V1 keep operating while V2 became billing-authoritative.

## M5.3: Monorepo Bridge + Repogen Spine Phase 1 (Assignment Pack Spine)

Refs:

- `/Users/dr.156/ZenOpsV2/docs/handoff-m5.3-monorepo-bridge.md`
- `/Users/dr.156/ZenOpsV2/docs/REPOGEN_SPINE_M5_3.md`
- `/Users/dr.156/ZenOpsV2/docs/changelog.md` (M5.3 entry)

### Two parallel things happened in the M5.3 era

1. **Monorepo bridge** (structural change)
2. **Repogen pack spine phase 1** (functional V2 feature work)

### 1) Monorepo bridge (structural)

What we did:

- Imported V1 into this repo as subtree under `legacy/v1/`.
- Added `BOUNDARIES_V1_V2.md`.
- Added root wrapper scripts (`dev-v1.sh`, `dev-v2.sh`, `smoke-v1.sh`).
- Added convenience package scripts for V1/V2 workflows.

Why we did it:

- Repogen-era changes require coordinated review across V1 and V2 interfaces, but not a runtime merge.
- Co-location improves reviewability and handoffs while keeping system boundaries hard.

Why this mattered later:

- M5.4-M5.6 could reference V1 and V2 in one repo while preserving separation rules.

### 2) Repogen Spine Phase 1 (assignment report packs)

What we did:

- Added assignment-level report-generation foundation for `SBI_UNDER_5CR_V1`.
- Introduced report-pack/job/artifact/evidence/audit generation tables.
- Added worker-based placeholder generation pipeline.
- Added assignment report-generation UI panel in V2 web.

Why we did it:

- We needed a reusable report-pack pipeline (packs/jobs/artifacts/audit/idempotency) before building deterministic work-order logic and later template rendering.

Why this mattered later:

- M5.4 work orders eventually bridge into this pack/job pipeline (M5.5).

### V1 relevance

- V1 was intentionally not merged into V2 runtime.
- V1 subtree inclusion was for coordination only.
- Repogen implementation remains V2-first.

## M5.4: Repogen Spine v1 (Deterministic Work-Order Data Spine, No DOCX)

Refs:

- `/Users/dr.156/ZenOpsV2/docs/REPOGEN_SPINE_V1.md`
- `/Users/dr.156/ZenOpsV2/docs/changelog.md` (M5.4 entry)
- `/Users/dr.156/ZenOpsV2/docs/implementation-log.md` (M5.4 summary)

### What we did

- Added deterministic Repogen work-order spine:
  - `repogen_work_orders`
  - `repogen_contract_snapshots` (immutable versions)
  - `repogen_evidence_items`
  - `repogen_rules_runs`
  - `repogen_comments`
- Added canonical contract schemas and `/v1/repogen/*` API surface.
- Implemented pure rules engine and readiness evaluator:
  - FMV / 95% / 80%
  - co-op inversion
  - sqft->sqm standardization
  - rounding rules
  - template selector metadata
- Added deterministic export bundle endpoint (future renderer input).
- Added placeholder compute-snapshot worker hook and idempotent job IDs.
- Added minimal Studio and Web operator surfaces for work orders/evidence/comments/status.
- Added billing hooks on status transitions (reserve/invoice draft planning semantics without template generation).

### Why we did it

- Template rendering was intentionally paused because the team needed a deterministic data contract first.
- The real risk in report generation is data ambiguity and missing evidence, not DOCX libraries.
- By locking rules/readiness/export first, later rendering becomes "mapping + render" instead of ad-hoc logic.

### Why this mattered later

- M5.5 could bridge work orders into packs/jobs because M5.4 standardized the input and readiness gates.
- M5.6 could build evidence intelligence because M5.4 formalized evidence and field data surfaces.

### V1 relevance

- No cross-write to V1 DB.
- Billing semantics from M5.1/M5.2 remain intact and are only hooked into Repogen transitions.

## M5.5: Repogen Factory Flow (Bridge M5.4 Spine -> M5.3 Packs, No Templates)

Refs:

- `/Users/dr.156/ZenOpsV2/docs/REPOGEN_FACTORY_FLOW_M5_5.md`
- `/Users/dr.156/ZenOpsV2/docs/changelog.md` (M5.5 entry)
- `/Users/dr.156/ZenOpsV2/docs/implementation-log.md` (M5.5 summary)

### What we did

- Bridged M5.4 work orders to M5.3 report pack/job pipeline:
  - work-order <-> pack linkage
  - factory bridge service
  - queued generation jobs + placeholder artifacts
- Added `repogen_deliverable_releases` for audited/idempotent manual deliverables release.
- Auto-created/linked packs on `READY_FOR_RENDER` (without auto-release).
- Added manual release endpoint with billing gates:
  - `CREDIT` -> consume reserved credit at release
  - `POSTPAID` -> require paid invoice or audited override
- Improved worker artifact metadata with deterministic export bundle hash.
- Updated Web and Studio UIs for pack/job status, billing gate visibility, and release flow.

### Why we did it

- The deterministic data spine (M5.4) still needed a factory output pathway to become operational.
- Deliverable release is high-risk, so release was kept manual and gated rather than automatic.
- Billing consumption had to happen at the true business event (release), not earlier.

### Why this mattered later

- M5.6 evidence intelligence improves upstream throughput into this exact factory/release path.
- Future DOCX rendering can plug into an already-audited and billing-gated factory pipeline.

### V1 relevance

- V1 remains untouched as a runtime system.
- V2 billing gates (which may reflect V1-era billing mode/account policy) are enforced entirely within V2 truth.

## M5.6: Repogen Evidence Intelligence v1 (No Template Rendering, No OCR Engine)

Refs:

- `/Users/dr.156/ZenOpsV2/docs/REPOGEN_EVIDENCE_INTELLIGENCE_M5_6.md`
- `/Users/dr.156/ZenOpsV2/docs/changelog.md` (M5.6 entry)
- `/Users/dr.156/ZenOpsV2/docs/implementation-log.md` (Detailed M5.6 record)

### What we did

- Added evidence requirement profiles and profile items:
  - `repogen_evidence_profiles`
  - `repogen_evidence_profile_items`
- Added canonical field definitions + audit-grade field-evidence links:
  - `repogen_field_defs`
  - `repogen_field_evidence_links`
- Added OCR placeholder jobs pipeline:
  - `repogen_ocr_jobs`
  - placeholder worker (`repogen-ocr-placeholder`) writing deterministic "not enabled" results
- Extended readiness evaluator to use profile-based evidence requirements and field-link warnings.
- Added Web/Studio checklist panels, profile selection, field-linking UI, OCR enqueue actions, and annexure auto-order action.
- Extended tests and RLS fixture coverage for new `repogen_*` tables.

### Why we did it

- Operators were still spending time guessing what evidence was missing and what supports which field.
- Throughput bottleneck was evidence intake structure, not OCR extraction or DOCX rendering.
- Building placeholders for OCR pipelines now de-risks future OCR engine integration.

### Why this mattered later

- Future OCR and template rendering can attach to an already explicit mapping graph:
  - evidence -> field -> contract -> rules -> readiness -> pack/release
- This dramatically reduces chaos when enabling automation later.

### V1 relevance

- None at runtime; M5.6 is fully V2-side.
- Boundary rules remained unchanged (no V1 DB writes, no template/OCR implementation in V1).

## Why the Milestone Sequence Was Correct (Causal Chain)

This sequence was deliberate:

1. **Foundation/RLS/tenant context first** so data isolation is not retrofitted.
2. **Ops workflow and master-data spine (M4.6)** so work has deterministic lifecycle and ownership.
3. **Billing truth in V2 (M4.7-M5.2)** so money-related decisions stop depending on legacy internals.
4. **Repogen pack spine and deterministic work-order spine (M5.3-M5.4)** before any rendering.
5. **Factory bridge + manual release billing gates (M5.5)** so deliverables become operationally safe.
6. **Evidence intelligence (M5.6)** to improve human throughput before OCR/template automation.

This is the core ZenOps design principle now:

- **Structure and auditability before automation**

## V1 Current Role (What Still Lives There)

V1 is still relevant and should be treated as an active legacy system, not archive code.

V1 continues to own (until migrated):

- legacy staff/admin UX
- legacy operational workflows
- operational postpaid invoice workflow used by current staff/customers
- legacy partner/referral operational paths

V1 already has (per M5.2 handoff context):

- billing handshake adapter to V2
- V2 billing visibility surfaces (monitoring, fail-open behavior)
- event emissions into V2 billing timeline

Current repo location:

- `/Users/dr.156/ZenOpsV2/legacy/v1`

## Current V2 State (As of M5.6)

### Billing

- V2 is the billing/control truth for:
  - credit balances/reservations/ledger
  - service invoices/payments/adjustments
  - billing policies and subscriptions
  - payment webhook ingestion and settlement logic

### Repogen

Operationally available in V2 (without template rendering):

- deterministic work orders
- contract snapshots + rules + readiness
- evidence items and evidence profiles
- field-evidence linking
- OCR placeholder queue
- factory pack/job/artifact pipeline
- manual deliverables release with billing gates

Still intentionally not implemented:

- real DOCX template rendering
- OCR extraction engine
- bank-specific template text/render packs

## Validation and Quality Discipline (Patterns Established)

Across milestones, the delivery pattern consistently used:

- layered commits by concern (`db -> rls -> contracts -> api -> worker -> ui -> tests -> docs`)
- OpenAPI/contract sync
- RLS expansion whenever tenant-owned tables were added
- idempotent job/action semantics for workers and high-risk endpoints
- smoke scripts for milestone flows
- boundary docs when V1/V2 interaction changed

Common validation commands used across later milestones:

- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm contract_check`
- `pnpm docker:test`

RLS integration note:

- Local runs may skip DB integration tests when `TEST_DATABASE_URL_*` env vars are absent.
- CI wiring was expanded in M5.5 to run repogen RLS coverage with a Postgres service.

## Checkpoints, Tags, and Useful Branch Landmarks

Useful tags visible in repo history:

- `v2-milestone-assignment-spine`
- `v2-m3-billable-finalize`
- `m4.1`
- `m4.2`
- `m4.3`
- `m4.4`
- `m4.5`
- `m5.2-handoff`
- `m5.4-handoff`

Key bridge / repogen branches referenced in docs/history:

- `codex/m4-6-masterdata-lifecycle`
- `codex/m5-3-monorepo-bridge`
- `codex/m5-3-repogen-spine`
- `codex/m5-5-repogen-factory-flow`
- `codex/m5-6-repogen-evidence-intelligence`

## What a New Engineer Should Do First (Practical Read Order)

1. Read `/Users/dr.156/ZenOpsV2/docs/BOUNDARIES_V1_V2.md`
2. Read `/Users/dr.156/ZenOpsV2/docs/implementation-log.md` (Scope Completed + Detailed M5.6 + Detailed M4.6/M4.6.1)
3. Read `/Users/dr.156/ZenOpsV2/docs/changelog.md` (M4.7 onward)
4. Read Repogen docs in order:
   - `/Users/dr.156/ZenOpsV2/docs/REPOGEN_SPINE_M5_3.md`
   - `/Users/dr.156/ZenOpsV2/docs/REPOGEN_SPINE_V1.md`
   - `/Users/dr.156/ZenOpsV2/docs/REPOGEN_FACTORY_FLOW_M5_5.md`
   - `/Users/dr.156/ZenOpsV2/docs/REPOGEN_EVIDENCE_INTELLIGENCE_M5_6.md`
5. Read `/Users/dr.156/ZenOpsV2/docs/ZENOPS_REPORT_GENERATION_REQUIREMENTS.md`

## Current Risks / Known Constraints (Important)

- Repogen is operationally structured but still **non-rendering** (no real DOCX output yet).
- OCR jobs are placeholders only (pipeline exists, extraction does not).
- V1 remains active and necessary for legacy operations; do not treat subtree presence as migration completion.
- Any cross-cutting work must preserve:
  - billing semantics (reserve/consume/release)
  - V1/V2 DB separation
  - idempotency and audit trails in worker and operator actions

## Suggested Next Logical Milestone (Post-M5.6)

The repo is now prepared for one of these tracks:

- **M5.7: Template Rendering Integration (DOCX only, on top of deterministic export bundle)**
- **M5.8: OCR Extraction Engine Integration (populate field suggestions into existing links/checklists)**
- **M5.x hardening: observability/metrics/SLA around Repogen queue and release gates**

Whichever is chosen, the implementation should continue using the same layered pattern:

- `feat(db)` -> `feat(rls)` -> `feat(contracts)` -> `feat(api)` -> `feat(worker)` -> `feat(ui)` -> `test(...)` -> `docs(...)`

## Final Takeaway

ZenOps is no longer "just a legacy ops app plus a new codebase." It is now:

- a **V2 billing-authoritative control/data platform**
- a **co-located but hard-bounded V1 legacy system**
- and a **deterministic Repogen factory pipeline** that is ready for future OCR and DOCX rendering work without rewriting the spine.

