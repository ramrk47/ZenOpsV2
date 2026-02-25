# V1 to V2 Workspace Mapping

This document highlights how features from the legacy V1 workspace should map to the updated V2 domain structure.

| V1 Feature (React/FastAPI) | V2 Equivalent Domain (NestJS/Prisma) | Recommended Design Change / Migration Path |
| --- | --- | --- |
| **Assignments Queue** (`/assignments`) | `apps/web` (Web workspace) / `assignments` | Port the exact V1 UI (KPI tiles, Search, advanced filter toggles) but route API requests to V2 `/v1/assignments`. Unify the "Repogen Work Orders" queue into this view or make it a seamless next step. |
| **Single Row Quick Preview** | Not present in V2 yet | Build the right-side Quick Preview sidebar component in V2 Web. It's critical for operator triage speed. |
| **Assignment Detail Tabs** | Assignment Detail page | Keep the Tab structure but align with V2 domains: <br/> `Overview`, `Evidence` (new Repogen docs/fields), `Tasks`, `Repogen` (computed values/snapshot), `Timeline`, `Billing`. |
| **Document Missing/Overdue Health Badges** | Repogen Readiness Evaluator & `assignment_status_history` | V2's `repogen_rules_runs` and evidence intelligence provide much richer data for health badges. Build a `ReadinessBadge` component. |
| **Document Preview Drawer** | `documents`, `document_links`, `packages/storage` | Adapt the V1 document drawer to use V2's robust presigned URL system and `repogen_evidence_items` linking. |
| **Tasks & Mentions** | `tasks`, `assignment_status_history` | Port V1 `AssignmentTask` components as-is, connected to V2's M4.6 operational task endpoints. |
| **Approvals Flow** | (Pending / Manual overrides in V2) | Replace V1's generic `approvals` with V2's specific workflow states (e.g. M5.5 Deliverables Release gating, Credit Overrides). |
| **Finance / Invoicing** | V2 Billing Control Plane (`service_invoices`) | Do NOT replicate V1 finance UI directly in the assignment. Instead, use V2's isolated `service_invoices` lane and show a "Linked Invoice" summary chip inside the assignment. |
| **Master Data Selectors (Bank, Branch)** | V2 Master Data (`banks`, `channels`, etc.) | Ensure V2 selectors use `Channel` modeling instead of V1 `Partner` terminology as established in M4.6. |

## Major Divergences
- **V2 Evidence Intelligence (M5.6)**: V1 had simple `Document` tags. V2 has `evidence_profiles`, `field_defs`, and `field_evidence_links`. The V1 "Documents" tab must be heavily upgraded into an "Evidence Inbox & Checklist".
- **Billing Control Plane**: V1 tied invoices directly to assignments. V2 has a central ledger, credit/postpaid policies, and billing gates. The Assignment UI should only display proxy states (e.g., "Credits Reserved", "Deliverables Releasable") and link to the central billing UI if the user is an admin.
