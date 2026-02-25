# REPOGEN SPINE v1 (M5.4)

Date: 2026-02-24
Status: Implemented (Phase 1 spine only, no DOCX rendering)

## Scope

M5.4 builds the deterministic Repogen data spine in ZenOps V2:

`Evidence -> Contract -> Rules -> Readiness -> Export/Snapshot -> Billing Gates`

This phase intentionally does **not** render DOCX/PDF templates. It creates the canonical data contract and readiness workflow so later template rendering is a pure mapping/render concern.

## Boundaries (V1/V2)

- V2 Repogen spine lives only in V2 schema/API/worker/UI.
- No cross-write to V1 DB.
- No billing credit/invoice logic rewrite; only repogen billing hooks into existing V2 billing-control service.
- Worker hook is placeholder only (`repogen_compute_snapshot`) and does not generate documents.

## Data Model (Repogen v1)

Prisma schema file: `/Users/dr.156/ZenOpsV2/packages/db/prisma/schema/100_repogen_spine_v1.prisma`

Entities:

- `repogen_work_orders`
  - source + assignment linkage + report/bank metadata + deterministic template selector + status
  - billing hook cache fields (`billing_mode_cache`, reservation/invoice refs, hook log json)
- `repogen_contract_snapshots`
  - immutable versioned canonical contract snapshots
  - stores `contract_json`, `derived_json`, `readiness_json`
- `repogen_evidence_items`
  - assignment/work-order evidence registry with annexure order metadata
  - `document_id` scalar link to V2 documents (no cross-system writes)
- `repogen_rules_runs`
  - records input snapshot -> output snapshot runs, warnings/errors, ruleset version
- `repogen_comments`
  - manual zones (justification/enclosures/checklist/notes)

## Canonical Contract (Zod)

Contract schema: `/Users/dr.156/ZenOpsV2/packages/contracts/src/repogen/contract.ts`

Key sections:

- `meta`
  - `report_type`, `bank_type`, `value_slab`, `template_selector`
- `party`
  - borrower/owner/client/bank branch/valuer/engineer placeholders
- `property`
  - address, locality identifiers, survey/cts/khata, land/built-up area, floor area list
- `valuation_inputs`
  - guideline/market/adopted rate inputs, units, FMV component inputs, depreciation percent
- `computed_values`
  - FMV, realizable, distress, co-op adopted/market values, rounding outputs, standardized area/rates
- `annexures`
  - ordered evidence references + grouping hints (`2-4` images per page metadata)
- `manual_fields`
  - `enclosures_text`, `checklist_json`, `justification_text`
- `audit`
  - snapshot version, created by, created at

API payload contracts: `/Users/dr.156/ZenOpsV2/packages/contracts/src/repogen/api.ts`

## Rules Engine (Pure TS)

Rules engine: `/Users/dr.156/ZenOpsV2/apps/api/src/repogen/rules/engine.ts`

Implemented rules (M5.4-v1):

- Value slab:
  - `< 5 Cr` => `LT_5CR`
  - `>= 5 Cr` => `GT_5CR`
- Template selector metadata:
  - `COOP` => `COOP_GENERIC`
  - `AGRI` => `AGRI_GENERIC`
  - `LT_5CR` => `SBI_FORMAT_A`
  - `GT_5CR` => `BOI_PSU_GENERIC`
- Value calculations:
  - `FMV`
  - `realizable_value = 95% of FMV`
  - `distress_value = 80% of FMV`
- Co-op inversion:
  - adopted -> market (`market = adopted / 0.8`)
  - market -> adopted (`adopted = market * 0.8`)
- Unit standardization:
  - sqft -> sqm conversion (`1 sqm = 10.7639 sqft`)
  - standardized area/rate outputs preserved in `computed_values` / `derived_json`
- Co-op rounding metadata:
  - round up to next `500`
- Warnings:
  - missing rate/address/bank details
  - suspicious market/guideline ratio
  - unit mismatch info warning

## Readiness Evaluator

Readiness evaluator: `/Users/dr.156/ZenOpsV2/apps/api/src/repogen/readiness/evaluator.ts`

Output shape:

- `completeness_score` (`0..100`)
- `missing_fields[]`
- `missing_evidence[]`
- `warnings[]`
- `required_evidence_minimums`

Explicit phase-1 readiness rules include:

- `VALUATION`
  - mandatory: bank name/branch, property address, land area, guideline rate or market rate
  - evidence: at least 6 valuation photos/screenshots/GEO items
- `DPR`
  - placeholders: project summary, project cost, means of finance
  - evidence: at least 4 photo/screenshot items
- `REVALUATION`, `STAGE_PROGRESS`
  - minimal placeholders + evidence thresholds defined in code

`READY_FOR_RENDER` status transition is blocked unless readiness has no missing fields/evidence.

## API Endpoints (`/v1/repogen/*`)

Implemented in:
- `/Users/dr.156/ZenOpsV2/apps/api/src/repogen/repogen-spine.controller.ts`
- `/Users/dr.156/ZenOpsV2/apps/api/src/repogen/repogen-spine.service.ts`

Endpoints:

- `POST /v1/repogen/work-orders`
  - create work order
- `GET /v1/repogen/work-orders`
  - list work orders (filters + readiness summary)
- `GET /v1/repogen/work-orders/:id`
  - detail: work order + latest snapshot + current readiness + evidence + comments + rules runs
- `PATCH /v1/repogen/work-orders/:id/contract`
  - applies partial contract patch
  - creates immutable input/output snapshots
  - runs rules engine immediately
  - stores rules run row and readiness snapshot
  - enqueues placeholder worker hook (`repogen_compute_snapshot`)
- `POST /v1/repogen/work-orders/:id/evidence/link`
  - links evidence metadata / `document_id`
  - supports `annexure_order`
- `GET /v1/repogen/work-orders/:id/comments`
  - list manual comments/notes
- `POST /v1/repogen/work-orders/:id/comments`
  - add manual zones text/comments
- `POST /v1/repogen/work-orders/:id/status`
  - controlled status transitions with readiness gate for `READY_FOR_RENDER`
  - billing acceptance hook on `DATA_PENDING`
  - planned consumption usage event on `READY_FOR_RENDER` (no consume in M5.4)
- `GET /v1/repogen/work-orders/:id/export`
  - deterministic export bundle JSON (contract + derived + readiness + evidence manifest)

## Billing Hooks (Phase 1)

- Status transition to `DATA_PENDING` triggers acceptance billing via existing billing-control service:
  - CREDIT mode: reserve `1` credit
  - POSTPAID mode: create/reuse service invoice draft
- Status transition to `READY_FOR_RENDER`:
  - logs planned consumption usage event only
  - does **not** consume credits / finalize billing in M5.4

## Worker Hook (Placeholder)

Queue: `repogen-compute-snapshot`

Files:
- `/Users/dr.156/ZenOpsV2/apps/api/src/queue/repogen-compute-queue.service.ts`
- `/Users/dr.156/ZenOpsV2/apps/worker/src/repogen-compute-snapshot.processor.ts`

Behavior:

- Enqueued on contract patch with idempotent job id:
  - `work_order_id:snapshot_version`
- Worker validates visibility of the work order + snapshot in worker context and logs placeholder processing.
- No rendering, conversion, OCR, or template mapping is executed.

## Minimal UI (Operator First)

- Studio:
  - Repogen tab with list/detail and JSON inspectors for snapshots/derived/evidence/comments/readiness
- Web (Core Tenant internal lane):
  - `Repogen` production queue page
  - create work order
  - patch contract JSON
  - link evidence (`document_id` / `file_ref`) + annexure order
  - add manual comments (justification/enclosures/checklist/notes)
  - status transitions
  - export bundle preview JSON

## Local Demo (curl)

Prereqs:
- ZenOps V2 API running (`/v1/meta` reachable)
- valid `web` or `studio` bearer token for a tenant

Example flow:

```bash
API_BASE_URL="http://127.0.0.1:3000/v1"
TOKEN="<bearer>"

# 1) create work order
WO_JSON=$(curl -sS -X POST "$API_BASE_URL/repogen/work-orders" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "source_type":"TENANT",
    "report_type":"VALUATION",
    "bank_name":"State Bank of India",
    "bank_type":"SBI"
  }')

WO_ID=$(printf '%s' "$WO_JSON" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(d.work_order_id)')

# 2) patch contract (triggers rules + snapshots + worker hook)
curl -sS -X PATCH "$API_BASE_URL/repogen/work-orders/$WO_ID/contract" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "ruleset_version":"m5.4-v1",
    "patch":{
      "property":{"address":"Demo site","land_area":{"value":1000,"unit":"sqft"}},
      "valuation_inputs":{"market_rate_input":{"value":2000,"unit":"sqft"},"land_value":2000000,"building_value":3000000}
    }
  }'

# 3) link evidence (replace with actual document_id)
curl -sS -X POST "$API_BASE_URL/repogen/work-orders/$WO_ID/evidence/link" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"items":[{"evidence_type":"PHOTO","doc_type":"OTHER","document_id":"<document-uuid>","annexure_order":1}]}'

# 4) inspect deterministic export bundle
curl -sS "$API_BASE_URL/repogen/work-orders/$WO_ID/export" \
  -H "authorization: Bearer $TOKEN" | jq .
```

## Not Implemented in M5.4 (Intentional)

- DOCX template rendering / template engines / conversion to PDF
- Bank-specific text blocks and exact template files
- OCR extraction from PDFs/images (only placeholder storage path exists in contract/evidence metadata)
- Auto-generated annexure pages/images in document output
- Credit consumption on render completion (only planned event logging)
