# Repogen Spine M5.3 (Phase 1)

## Purpose

This document describes the V2 report-generation foundation ("Repogen spine") implemented for M5.3 Phase 1.

Phase 1 is intentionally limited to:

- template family: `SBI_UNDER_5CR_V1`
- workflow: upload-first + draft fields + evidence linkage + worker-triggered generation
- output: placeholder DOCX artifact generation with correct job/pack/artifact persistence and versioning

This is a spine for future template families (`PSU_GENERIC_OVER_5CR_V1`, `COOP_LB_V1`, DPR, stage-progress, annexures), not a full template engine yet.

## Non-Negotiable Boundary Compliance

- Billing/credits/subscriptions/payment rails remain on existing M5.1/M5.2 flows.
- Repogen Phase 1 does **not** reuse the billing-coupled `reportRequest/reportJob/finalize` lifecycle.
- No V2 -> V1 DB writes and no V1 DB access from this feature.
- V1/V2 compose stacks and envs remain separate.
- Generation runs through the worker queue (`repogen-generation`), not in API request path.

## Architecture (Phase 1)

### 1) Data model (V2)

New Repogen spine tables:

- `report_packs`: assignment-scoped generated report pack versions
- `report_pack_artifacts`: generated files per pack (DOCX/PDF/etc.)
- `report_field_values`: normalized draft values (`manual|ocr|derived`)
- `report_evidence_links`: assignment/template field or section -> uploaded document linkage
- `report_generation_jobs`: idempotent worker jobs (`tenant_id + idempotency_key`)
- `report_audit_logs`: append-only audit/timeline for draft/evidence/job/pack changes

Template registry reuse/extension:

- existing `report_templates` and `template_versions` tables were extended with:
  - `template_key`
  - `family`
  - `status`
  - version `storage_ref` / manifest fields

This avoids introducing a duplicate template registry while still satisfying the Repogen template spine requirements.

### 2) API (V2)

New assignment-scoped endpoints (Repogen module):

- `GET /v1/assignments/:id/report-generation/context`
- `PATCH /v1/assignments/:id/report-generation/draft`
- `PUT /v1/assignments/:id/report-generation/evidence`
- `POST /v1/assignments/:id/report-generation/generate` (idempotent trigger)
- `GET /v1/report-generation/jobs/:jobId`
- `GET /v1/assignments/:id/report-generation/packs`

Contracts added in `@zenops/contracts` include:

- draft field upserts
- evidence link upserts
- generation trigger payload
- draft context / packs queries
- OCR placeholder metadata (`status/provider/raw_text/confidence/...`) without implementing OCR extraction yet

### 3) Worker pipeline (V2)

Queue:

- `repogen-generation`

Worker behavior (phase 1):

- loads `report_generation_jobs`
- idempotently skips already-completed jobs with a linked pack
- transitions `queued -> processing -> completed|failed`
- increments attempts
- creates next `report_packs.version` for assignment/template
- writes placeholder DOCX artifact to local artifacts root
- persists `report_pack_artifacts`
- writes `report_audit_logs` events for completed/failed

### 4) UI (V2 web assignment detail)

Minimal "Report Generation" tab/panel under assignment detail page:

- draft fields editor (minimal field set)
- evidence attachment controls that reuse assignment-linked documents
- warnings list
- generate button
- job status (with polling refresh)
- report pack + artifact list

This is operator-testable but intentionally not a full report builder UI.

## Phase 1 Warning Model (Current)

Warnings are computed server-side from draft fields/evidence and returned via draft context:

- missing required fields for `SBI_UNDER_5CR_V1`
- missing evidence sections (`guideline_screenshot`, `gps_photos`, `site_photos`, `google_map`, `route_map`)
- OCR placeholder status warnings (`pending` / `failed`)
- FMV vs guideline variance warning (`>= 20%`)

Warnings are non-blocking in Phase 1.

## Idempotency + Versioning

### Generation trigger idempotency

- `report_generation_jobs` enforces uniqueness on `(tenant_id, idempotency_key)`.
- Repeated trigger calls with the same key return the existing job.
- Reuse of the same key for a different assignment/template is rejected.

### Report pack versioning

- Each successful generation creates a new `report_packs` row with incrementing `version` per `(assignment_id, template_key)`.
- Generated artifacts are linked to that immutable pack version via `report_pack_artifacts`.
- Older packs are retained; outputs are not overwritten.

## Files Added / Extended (V2)

Key implementation areas:

- DB schema: `packages/db/prisma/schema/*` + `infra/sql/010_rls.sql`
- Contracts: `packages/contracts/src/index.ts`
- API: `apps/api/src/repogen/*`, `apps/api/src/queue/repogen-queue.service.ts`, `apps/api/src/app.module.ts`
- Worker: `apps/worker/src/repogen.processor.ts`, `apps/worker/src/index.ts`
- UI: `apps/web/src/App.tsx`

## Tests Added (Phase 1)

- API service: generation trigger idempotency
- API service: evidence link persistence + retrieval in draft context
- Worker processor: job state transitions
- Worker processor: report pack version increment basics

## Known Phase 1 Limits (Intentional)

- Placeholder DOCX generation only (no real DOCX template merge yet)
- OCR extraction engine not implemented (only placeholder metadata contracts/fields)
- Minimal draft field set in UI
- No PDF conversion/annexure rendering yet
- No advanced clause library / preview diff / section-level template editor yet

## Next Phase Suggestions (M5.3.x)

- real DOCX merge for `SBI_UNDER_5CR_V1`
- derived field persistence (FMV/realisable/distress/depreciation) with traceability
- richer field schema registry + validation rules
- annexure layout generation and image placement
- additional template families (`PSU_GENERIC_OVER_5CR_V1`, `COOP_LB_V1`)
