# V2 Workspace Implementation Backlog

This backlog prioritizes the reconstruction of the V1 workspace into V2 UI code (`apps/web`), sequenced to respect existing dependencies and deliver immediate operator value.

## Milestone M5.6.1: Workspace Core Uplift
*Goal: Bring V1 usability patterns (KPI strips, Quick Preview) into the V2 web application.*
- **Components to build:**
  - `QueueTable.tsx` (Compact data table with sticky headers)
  - `HealthBadge.tsx` (Due soon, Overdue states)
  - `QuickPreviewSidebar.tsx` (Slide-out panel for active row)
- **Files to touch:** `apps/web/src/app/queue/page.tsx`, `apps/web/src/components/ui/...`
- **API Setup:** Hook frontend to existing V2 `GET /api/v1/assignments` (or create a proxy if CORS is required).

## Milestone M5.6.2: Evidence Inbox & Tasks
*Goal: Rebuild the details view, replacing the legacy 'Documents' tab with the new 'Evidence' model.*
- **Components to build:**
  - `AssignmentWorkspaceLayout.tsx` (Tabs)
  - `EvidenceDropzone.tsx` (Hooks into V2 storage APIs)
  - `TaskBoard.tsx` (Inline editable tasks)
- **API Setup:** Connect to M5.4 Repogen Evidence endpoint (`POST /reports/evidence`), ensuring uploads correctly mint `repogen_document_links`.

## Milestone M5.6.3: Billing Gating UX Polish
*Goal: Clarify the release gates established in M5.5 directly in the workspace.*
- **Components to build:**
  - `ReleaseGateStatus.tsx` (Visual lock/unlock based on ledger credits).
  - `GateOverrideModal.tsx` (Admin only: bypass credit checks).
- **API Setup:** Surface boolean `releasable` flags in the assignment detail fetch based on `check_gate_status` rules.

## Milestone M5.6.4: Intelligence & Location (New Scope)
*Goal: Integrate Aadhaar OCR, Google Maps distance rendering, and CoreLogic parameters.*
- **Aadhaar OCR Pipeline:**
  - Add an `extract` trigger to the `EvidenceDropzone` specifically for `Category: AADHAAR`.
  - Stub out an API worker pipeline (`POST /api/intelligence/ocr/aadhaar`) that returns mock extracted JSON payload.
- **Location Services (Google Maps + CoreLogic):**
  - Create `IntelligenceMap.tsx` component for the Overview tab.
  - Establish a background job trigger: upon receiving property coordinates and bank branch coordinates, fire a puppeteer/headless script to capture a Google Maps driving route screenshot and attach it to the Evidence inbox.
  - Implement CoreLogic (Cotality) API stubs to enrich the valuation block with external risk/comp data.
