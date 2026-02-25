# ZenOps V1 / V2 Terminology Glossary

As ZenOps transitions from V1 to V2 and we add more capabilities (Repogen, Studio, Portals), a strict domain language is required to avoid confusion across repositories, assets, and conversations.

This document serves as the proposed source of truth for all naming conventions.

## 1. Core Applications & Interfaces

| Term | Description | V1 Equivalent |
| :--- | :--- | :--- |
| **Workspace (Web App)** | The internal operator application (`apps/web`). This is where internal staff triage queues, review evidence, and process assignments. | V1 Dashboard / App |
| **Studio (Template Builder)** | The internal application (`apps/studio`) used by admins to build, structure, and test Docx/PDF report templates (The Repogen Tooling). | None (New in V2) |
| **Portal (Tenant/Client App)** | External-facing applications (`apps/portal`) where clients (e.g., Banks, field partners) can log in to view status or upload documents securely. | V1 Client Portal |

## 2. Core Entities & Domains

| Term | Description | V1 Equivalent |
| :--- | :--- | :--- |
| **Assignment** | The core unit of work. Represents a specific valuation or inspection request for a single property. | Assignment |
| **Repogen / Work Order** | "Repogen" is the automated report generation engine. A "Work Order" is the specific instruction to run the engine for an Assignment. | None (Manual in V1) |
| **Task** | An actionable checklist item attached to an Assignment (e.g., "Review Site Photos", "Call Bank Manager"). | Assignment Task |
| **Channel / Source** | The origination point of the assignment (e.g., Direct, API Integration, Specific Bank Branch). | Partner / Source |

## 3. Evidence & Document Management

| Term | Description | V1 Equivalent |
| :--- | :--- | :--- |
| **Evidence Inbox** | The unified component in the Workspace where all incoming documents, photos, and API-ingested files land for an assignment. | Documents Tab |
| **Evidence Link / Item** | A specific file attached to an assignment categorized by `purpose` (e.g., SITE_PHOTO, AADHAAR_CARD, REFERENCE_DOC). | Document |

## 4. Billing & Financials (The Control Plane)

| Term | Description | V1 Equivalent |
| :--- | :--- | :--- |
| **Credit Ledger** | The central system tracking available prepaid credits for a tenant/channel. | None (Postpaid only) |
| **Billing Gate** | A system check that prevents the final report from being released if credits are insufficient or there are unpaid overdue invoices. | Manual Check |
| **Service Invoice** | A chronological record of billing charges for assignments completed in a given period. | Invoice |

## 5. Organizational Hierarchy

| Term | Description | V1 Equivalent |
| :--- | :--- | :--- |
| **Tenant** | A distinct organizational boundary (e.g., a specific valuation firm using ZenOps). Data is strictly isolated between tenants. | Instance / DB |
| **User (Internal)** | An employee or operator logging into the Workspace or Studio. | User |
| **Contact (External)** | A person associated with a Client/Channel (e.g., a bank employee) who may log into a Portal. | Client User |

---

### Request for Review

Please review the above terminology. 
1. Are there any other specific components, assets, or scripts you want explicitly named?
2. Do you agree with the separation of `Workspace`, `Studio`, and `Portal`?
3. Once approved, we will enforce this terminology across all future architecture discussions, PRs, and UI labels.
