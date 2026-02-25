# V2 Workspace 2.0 Specification

## Objective
Rebuild the primary operator workspace in V2 (Next.js/React + Tailwind) to match the triage speed of V1 while supporting V2's Repogen (evidence intelligence) and Billing Control Plane. 

*New feature mandate: Integrate CoreLogic data surfaces and Aadhaar OCR ingestion for location/documentation enhancements.*

## 1. Global Navigation & Layout
- **Path:** `apps/web/src/components/layout/WorkspaceLayout.tsx`
- **Sidebar:** Keep the slim left-hand nav rail. 
  - Routes: `My Day`, `Queue`, (`Invoices` hidden behind Admin RBAC).
- **KPI Action Bar:** Pin to the top under the header. 
  - Chips: `Open`, `Due Soon`, `Overdue`, `Missing Docs`.
- **UI Density:** Provide a toggle in user settings for `Compact` vs `Comfortable` rows, defaulting to Compact for desktop operators.

## 2. The Core Queue (`/queue`)
- **Path:** `apps/web/src/app/queue/page.tsx`
- **Hook Data:** Sourced from V2 `/v1/assignments` (read-only mirror endpoint to respect V1/V2 boundaries) joined with V2 `assignment_status_history` overrides.
- **Components:**
  - `QueueTable`: Sortable by Due Date, Status, Missing Docs.
  - `HealthBadge`: (Green=Clear, Orange=Missing Evidence, Red=Overdue).
  - `QuickPreviewDrawer`: Slides out from the right on row click. 

## 3. Assignment Detail (The Workspace) (`/queue/[id]`)
- **Path:** `apps/web/src/app/queue/[id]/page.tsx`
- **Tab Structure**:
  1. **Overview & Property Data**
  2. **Evidence Inbox & OCR Checklist** (replaces V1's "Documents" tab)
  3. **Tasks & Notes** (Mentions enabled)
  4. **Billing Release Gates** (View-only for ops, actionable for admins)
  
## 4. New V2 Workspace Enhancements 
### 4.1 Aadhaar OCR Ingestion & Analysis
- **Goal:** Automate KYC/Address mapping by ingesting Aadhaar cards.
- **Workflow:** 
  - Operator uploads Aadhaar image to the *Evidence Inbox*.
  - V2 Worker runs an OCR pass (placeholder engine for now, hook ready).
  - Extracted JSON (Name, Address, DoB, UID) is mapped to V2 `repogen_evidence_items.extracted_data`.

### 4.2 Location Intelligence (Google Maps + CoreLogic)
- **Goal:** Capture location-based boundaries and map distance from property to banking branch.
- **Implementation:**
  - A new `Property Intelligence` pane in the Overview tab.
  - Uses CoreLogic APIs (Cotality) to enrich property details securely based on extracted Aadhaar address / LatLong.
  - **Distance Screenshots:** An automated worker task takes the coordinates of the Property and the Bank Branch (from V2 Channel master data) and generates a Google Maps routing screenshot, saving it directly as an image into the assignment's `Evidence Inbox`.

## 5. Security & Boundary Rules
- **Rule 1:** V2 frontend must NEVER write directly to V1 tables. Write requests for assignment reassignment or status bumps go to a V2 API proxy endpoint that pushes events to V1.
- **Rule 2:** Billing components are purely read-only indicators unless the user holds `modify_invoice` capabilities. Operators only see a lock icon (e.g., "M5.5 Pre-Release Gate Active").

## Next Step
Review the `WORKSPACE_MILESTONE_BACKLOG.md` to see the sequence of implementation for these components.
