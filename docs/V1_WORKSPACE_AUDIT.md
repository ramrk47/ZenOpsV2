# V1 Workspace Audit
*Source: `/Users/dr.156/zen-ops/`*

## 1. App Structure & Tech Stack
- **Frontend**: React (Vite), React Router for SPA navigation. Heavy use of functional components and hooks (`useAuth`).
- **Styling**: Context implies custom CSS/tokens (`styles.css` is quite large at 60KB). Common UI components built in-house (`PageHeader`, `Badge`, `Card`, `DataTable`, `KpiTile`, `EmptyState`, `Tabs`).
- **Backend**: Python (FastAPI), SQLAlchemy. Router-based domain model (`assignments`, `invoices`, `analytics`, `tasks`, etc.).

## 2. Navigation Map (IA)
Based on `App.jsx` and `EmployeeLayout`, the V1 workspace is segregated by Role/Capabilities:

**Core Employee / Valuer Routes:**
- **Dashboard / Home**: `/account` or `/assignments`
- **Assignments**: `/assignments` (Queue), `/assignments/new`, `/assignments/:id`
- **Inbox/Utilities**: `/calendar`, `/notifications`, `/invoices`, `/requests`

**Admin Routes (Control Plane):**
- `/admin/dashboard`, `/admin/workload`, `/admin/open-queue`
- `/admin/approvals`, `/admin/activity`, `/admin/analytics`
- `/admin/personnel`, `/admin/masterdata`, `/admin/company`, `/admin/system-config`
- `/admin/payroll/...`, `/admin/external-associate-requests`, `/admin/billing-monitor`

## 3. Daily Screen: The Queue (`Assignments.jsx`)
- **Top KPIs**: "Visible", "Open", "Due Soon" (warn), "Overdue" (danger). Helps operators immediately focus on SLA risks.
- **Filtering System**: 
  - Saved views dropdown (`Saved views`, `Save View`, `Delete View`)
  - Universal search (code, borrower, bank, client)
  - Quick-filter chips: `Open`, `Due soon`, `Overdue`, `Mine`.
  - Advanced filter panel: Status, Case Type, Service Line, Assignee, Bank, Branch, Property Type, Paid/Unpaid.
- **Data Table Layout**: 
  - Supports `Comfortable` vs `Compact` view toggle.
  - Columns: Code, Borrower, Status (Badge), Case/Service Line, Assigned, Due (Badge), Fees, Dates.
  - Selecting a row highlights it and populates a "Quick Preview" right sidebar.
- **Quick Preview**: Shows kicker data, health badges (missing docs, overdue), notes, and direct CTAs to "Open Workspace" or "Duplicate Pattern".

## 4. The Workspace: Assignment Detail (`AssignmentDetail.jsx`)
- **Tabs structure**: Overview, Documents, Tasks, Timeline, Chat, Approvals, Finance, Outputs.
- **Overview Panel**: 
  - Rich form for master data mapping (bank, branch, client, property type/subtype).
  - Built-up area calculation relying on `multiFloorEnabled` sub-table.
- **Key UX details**: 
  - **HealthBadges**: Missing Docs (Orange), Overdue (Red), Payment Pending.
  - **Mentioning system**: Chat input `@[User Name](id)` with dropdown selection.
  - **Document Drawer**: `DocumentPreviewDrawerV2` for quick previewing and tagging documents.
  - **Approvals**: Integrated approval request flow (e.g. `Fee Override`, `Delete Assignment`, `Mark Paid`) for governance.
  - **Tasks**: Inline task editing (`initTaskDrafts`) rather than modal jumps.

## 5. V1 Pain Points and Structural Limits
- **State Monolith**: The `AssignmentDetail.jsx` file is massive (2100+ lines). It handles everything from property updates to task drafts, message mentions, and document uploads.
- **Domain Muddle**: Billing/Finance, Operations, and specific valuation logic (floors, property subtypes) are all tightly coupled to the single `Assignment` object.
- **Templates**: Document templating (`FileTemplatesTab`) appears to be file-registry based, leading into the Repogen need established in V2.

## 6. What Must Be Kept (The "Essence")
- **KPI strips and Health Badges**: Operators depend on color-coded chips (Due Soon, Overdue, Missing Docs) to triage work.
- **Speed & Density**: The "Compact" queue view with the Quick Preview sidebar allows rapid triage without page loads.
- **Inline editing**: Tasks and assignments edit inline to the workspace rather than demanding separate pages for minor status bumps.
