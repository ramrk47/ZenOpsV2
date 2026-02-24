# ADR-0004: Invoice Numbering, Canonical Totals, and Idempotency

## Status
Accepted

## Context
Invoices are a core financial artifact in Zen Ops — they track what the valuation firm bills its clients for each assignment. Several problems existed in the original invoice implementation:

- **No structured numbering**: Invoices had user-entered or auto-incremented numbers with no financial-year awareness, making accounting reconciliation difficult.
- **Client-computed totals**: The frontend calculated subtotals, tax, and amounts due from line items. This caused drift when items were added/removed without refreshing, and produced `0.00` totals when items weren't properly attached before computation.
- **Duplicate actions on retries**: Network failures during "send reminder" or "mark as paid" could trigger duplicate notifications, follow-up tasks, or state transitions if the user retried the request.
- **No payment/adjustment tracking**: Partial payments, credit notes, and write-offs had no structured representation.

The invoice system needed to become the financial source of truth — with server-authoritative totals, safe retries, and auditable numbering.

## Decision

### 1. Financial-Year Sequential Numbering
- Invoices are numbered per Indian fiscal year (April–March): `Z{FY_label}-{sequence:05d}` (e.g., `ZFY26-00001`).
- FY label derivation: if `issued_date.month >= 4` then `FY{year+1}`, else `FY{year}`. This is India-specific and hardcoded.
- An `InvoiceSequence` table stores `financial_year` (unique) and `last_number`. The row is locked via `SELECT ... FOR UPDATE` during number assignment to prevent race conditions under concurrent creation.
- Assignment code is also embedded in invoice references where needed (`{assignment_code}-I{nn}`), linking invoices to their parent assignment for quick lookup.

### 2. Canonical Server-Side Totals
- All monetary values are recomputed server-side on every invoice mutation (create, update, add/remove item, record payment, apply adjustment). The function `recompute_totals()` in `services/invoices.py` is the single source of truth:
  - `subtotal` = sum of all `InvoiceItem.line_total`
  - `tax_amount` = computed from per-item tax rates or a global invoice `tax_rate`
  - `total_amount` = subtotal + tax_amount
  - `amount_paid` = sum of all `InvoicePayment.amount`
  - `amount_credited` = sum of all `InvoiceAdjustment.amount`
  - `amount_due` = total_amount - amount_paid - amount_credited
- Uses `Decimal` arithmetic with `ROUND_HALF_UP` rounding throughout to avoid floating-point drift.
- Invoice status is **inferred from the balance**, not set manually:
  - `amount_due <= 0` → `PAID`
  - `amount_due > 0` and (`amount_paid > 0` or `amount_credited > 0`) → `PARTIALLY_PAID`
  - Otherwise → retains current status (`DRAFT`, `ISSUED`, `SENT`)
- Migration `0012_backfill_invoice_totals` retroactively recomputes totals for all existing invoices using the same logic.

### 3. Idempotency Key Mechanism
- Endpoints that perform side effects (reminders, follow-up creation) accept an `Idempotency-Key` HTTP header.
- The `IdempotencyKey` model stores: `key` (client-provided), `scope` (endpoint identifier, e.g., `"invoice_remind"`), `user_id`, `request_hash` (SHA256 of the request payload), and `response_payload` (JSON of the original response).
- Unique constraint on `(key, scope, user_id)` ensures a given key can only be used once per scope per user.
- On replay (duplicate key): the system returns the cached `response_payload` without re-executing the operation. If the `request_hash` differs (same key, different payload), it returns a conflict error.
- On concurrent duplicate requests: `IntegrityError` from the unique constraint triggers a rollback, re-query, and cached response return.

### 4. Reminder Rate Limiting
- The invoice reminder endpoint (`POST /api/invoices/{id}/remind`) has two rate limit layers beyond idempotency:
  - **Per-invoice cooldown**: No reminder for the same invoice within the last 24 hours (checked via `ActivityLog` for recent `INVOICE_REMINDER` events).
  - **Per-user throttle**: Maximum 10 reminders within any 10-minute window per user (prevents bulk-spam of reminders).
- On successful reminder: an `invoice_overdue` follow-up task is created with DB-level deduplication (partial unique index on `assignment_tasks` for `invoice_id` + task type), and a calendar event of type `PAYMENT_FOLLOWUP` is linked.

### 5. Invoice PDF Generation
- `POST /api/invoices/{id}/pdf` generates a PDF using ReportLab, including amount-in-words (via `num2words`), line items, tax breakdown, and payment history.
- PDF metadata is persisted on the invoice: `pdf_generated_at`, `pdf_path`, `pdf_generated_by_user_id`.
- PDFs are stored in the uploads directory and served via the document download endpoint with access control.

### 6. Structured Payment and Adjustment Models
- `InvoicePayment`: records individual payments with `amount`, `paid_at`, `mode` (CASH, BANK_TRANSFER, UPI, CHEQUE, CARD, MANUAL, OTHER), `reference_no`.
- `InvoiceAdjustment`: records credit notes, discounts, and write-offs with `amount`, `type` (CREDIT_NOTE, DISCOUNT, WRITE_OFF, OTHER), `issued_at`.
- `InvoiceTaxBreakdown`: snapshots GST components (CGST, SGST, IGST, CESS) for compliance.
- `InvoiceAuditLog`: records mutation events with `event_type` and `diff_json` for audit trails.

## Consequences
- **Totals overwrite user input**: Any client-sent total values are ignored; the server always recomputes. This prevents tampering but means the frontend cannot display "preview" totals that differ from server state.
- **FY logic is India-specific**: The April–March fiscal year is hardcoded. International deployments would need a configurable FY start month.
- **Sequence lock contention**: The `FOR UPDATE` lock on `InvoiceSequence` serializes concurrent invoice creation within the same FY. At current volumes (dozens of invoices per month) this is negligible. Would need a gap-free sequence generator or pre-allocated ranges at high throughput.
- **Idempotency is per-endpoint, not global**: Each endpoint that needs idempotency must explicitly implement the key check. There is no middleware-level idempotency. This is intentional (not all endpoints need it) but requires discipline when adding new mutation endpoints.
- **Status is implicit, not a state machine**: Invoice status is derived from balance math rather than explicit transitions. There are no guards preventing illogical transitions (e.g., paying a DRAFT invoice). This is acceptable for the current trust model (internal users only create invoices) but would need validation for self-service billing.
- **Audit log is manual**: `InvoiceAuditLog` entries are created explicitly in service code, not via database triggers. Missing an audit call means a mutation goes unrecorded. A trigger-based approach would be more reliable but adds DB complexity.

## Alternatives Considered
- **UUID-based invoice numbers**: Use UUIDs instead of sequential numbers. Rejected because accountants and clients expect human-readable sequential numbers for filing and reference.
- **Application-level locking (Redis)**: Use a distributed lock instead of DB row lock for sequence generation. Rejected — the system runs on a single Postgres instance, and `SELECT FOR UPDATE` is simpler, transactional, and sufficient.
- **Middleware-level idempotency**: Implement idempotency as FastAPI middleware that intercepts all POST/PUT requests. Rejected because most endpoints don't need it, and the key semantics (scope, hash validation) vary per endpoint.
- **Event-sourced invoice ledger**: Store invoice mutations as an append-only event stream and derive current state. Rejected for complexity — the current model with audit logs provides adequate traceability without the architectural overhead of event sourcing.
- **Client-authoritative totals**: Trust the frontend to compute and submit correct totals. Rejected after observing the `0.00` totals bug where items weren't attached to the invoice relationship before computation. Server-side recomputation eliminates this class of bugs entirely.

## Key Files
- `backend/app/services/invoices.py` — numbering, `recompute_totals()`, reminder rate limiting, follow-up creation
- `backend/app/routers/invoices.py` — CRUD endpoints, reminder endpoint with idempotency, PDF endpoint
- `backend/app/services/invoice_pdf.py` — ReportLab PDF generation with amount-in-words
- `backend/app/models/invoice.py` — Invoice, InvoiceItem, InvoicePayment, InvoiceAdjustment, InvoiceTaxBreakdown, InvoiceAuditLog, InvoiceSequence, IdempotencyKey
- `backend/alembic/versions/0011_invoice_overhaul.py` — invoice model expansion (payments, adjustments, tax, audit)
- `backend/alembic/versions/0012_backfill_invoice_totals.py` — retroactive total recomputation
- `backend/alembic/versions/0008_invoice_followups_and_idempotency.py` — idempotency keys table, follow-up task dedupe index
