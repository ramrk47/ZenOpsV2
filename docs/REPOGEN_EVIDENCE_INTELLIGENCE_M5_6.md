# Repogen Evidence Intelligence v1 (M5.6)

Last updated: 2026-02-24

## Scope

M5.6 increases Repogen throughput by making evidence intake deterministic and operator-friendly:

- Evidence requirement profiles (per report type / bank type / value slab)
- Profile-driven missing evidence checklist
- Field-to-evidence links (snapshot-scoped, audit-visible)
- OCR placeholder queue/job pipeline (no OCR extraction engine)
- Readiness 2.0 using profile requirements + field-link warnings

This milestone does **not** implement DOCX rendering, OCR extraction, or bank template files.

## Data Model (New Tables)

- `repogen_evidence_profiles`
  - profile metadata and selection defaults
- `repogen_evidence_profile_items`
  - required/optional evidence items (`min_count`, `doc_type`, `tags_json`, order hints)
- `repogen_field_defs`
  - canonical field keys/operators labels for manual linking
- `repogen_field_evidence_links`
  - snapshot-scoped manual links (`field_key` -> `evidence_item_id`)
- `repogen_ocr_jobs`
  - placeholder OCR jobs/results (`QUEUED|DONE|FAILED`)

RLS:
- Tenant isolation enabled on all M5.6 repogen tables via `org_id`
- Portal remains default-deny for M5.6 evidence-intelligence tables in this phase

## Default Evidence Profiles (Seeded)

Seeded minimal profiles are derived from `/Users/dr.156/ZenOpsV2/docs/ZENOPS_REPORT_GENERATION_REQUIREMENTS.md`:

- `VALUATION` baseline (SBI/PSU/co-op/agri variants)
  - documents: `SALE_DEED`, `RTC`, `EC`, `KHATA`, `TAX`, `PLAN`
  - photo/screenshot categories: exterior, interior, surroundings, GPS, Google map, route map
- `COOP` metadata note/checklist item
  - adopted/market inversion reminder
  - round-up-to-next-500 review note (metadata only)
- `AGRI` minimal agri evidence profile
- baseline profiles for `DPR`, `REVALUATION`, `STAGE_PROGRESS`

## Readiness 2.0

Readiness evaluator now supports:

- profile-based evidence requirements (instead of only hardcoded counts)
- `missing_field_evidence_links` warning bucket for required fields that have no evidence link
- existing missing-fields and missing-evidence gating behavior preserved

READY_FOR_RENDER gate:
- still blocks on `missing_fields` or `missing_evidence`
- field-evidence links are warnings in M5.6 (non-blocking)

## API Endpoints (M5.6)

New/extended under `/v1/repogen/*`:

- `GET /work-orders/:id/evidence-profiles`
  - returns selected profile, selectable profiles, checklist, suggestions, field defs
- `POST /work-orders/:id/evidence-profile`
  - select profile (`profile_id`) or choose default (`use_default=true`)
- `GET /work-orders/:id/field-evidence-links`
  - list latest-snapshot field links + field definitions
- `POST /work-orders/:id/field-evidence-links`
  - create/update/remove manual field-evidence links (audit note written)
- `POST /work-orders/:id/ocr/enqueue`
  - enqueue placeholder OCR job for an evidence item

Existing endpoint behavior improved:
- `POST /work-orders` auto-selects default evidence profile when possible
- `PATCH /work-orders/:id/contract` computes readiness using selected profile requirements
- `GET /work-orders/:id` now includes `field_evidence_links` and `ocr_jobs` in detail payload

## Worker Pipeline (OCR Placeholder)

Queue:
- `repogen-ocr-placeholder`

Worker behavior:
- consumes queued `repogen_ocr_jobs`
- writes placeholder result JSON:
  - `extracted_text: ""`
  - `detected_fields: []`
  - `note: "OCR not enabled yet"`
- marks job `DONE`
- idempotent skip when already `DONE`

## UI (Web + Studio)

Web (`/Users/dr.156/ZenOpsV2/apps/web/src/repogen-queue-page.tsx`):
- evidence checklist panel (profile-based)
- profile selector/save
- suggested evidence for missing fields
- field-to-evidence manual linking (dropdowns)
- OCR enqueue buttons per evidence item
- auto-order annexure action (editable after auto-order)
- quick actions: prefill evidence form / mark as received

Studio (`/Users/dr.156/ZenOpsV2/apps/studio/src/repogen-panel.tsx`):
- checklist visibility + suggestions
- profile selector
- field-to-evidence manual linking and removal
- audit-visible notes via existing timeline/comments

## Demo Locally (curl flow)

Recommended script:
- `/Users/dr.156/ZenOpsV2/scripts/demo-m5.6-evidence.sh`

Manual flow summary:
1. Login web operator token
2. Create repogen work order
3. Patch contract to create snapshots
4. Link evidence metadata items
5. `GET /evidence-profiles` to inspect checklist
6. `POST /evidence-profile` (optional manual profile selection)
7. `POST /field-evidence-links` to link required fields to evidence
8. `POST /ocr/enqueue` for one evidence item
9. Poll `GET /work-orders/:id` to see `ocr_jobs` placeholder result
10. Transition to `READY_FOR_RENDER` only after profile checklist missing evidence clears

## Non-Goals / Not Implemented

- Real OCR extraction (PDF/image parsing)
- OCR confidence/field extraction engine
- DOCX template rendering or conversion
- Bank template files / static bank paragraph blocks
- Automatic field extraction from evidence

