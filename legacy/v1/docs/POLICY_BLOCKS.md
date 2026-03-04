# Policy Blocks (Phase 4)

This document defines the policy-driven land detail blocks used by V1 New Assignment.

## Blocks

- `NORMAL_LAND`
  - Enables top-level land area capture (`land_area`).
- `SURVEY_ROWS`
  - Enables survey-wise capture via `assignment_land_surveys` rows:
    - `survey_no`, `acre/gunta/aana`
    - `kharab_acre/kharab_gunta/kharab_aana`
  - Backend can require at least one survey row when policy marks this block as required.
- `BUILT_UP`
  - Enables built-up area section (`builtup_area`) and optional floor-wise breakup (`floors`).

## Policy Source of Truth

Effective policy is resolved in this order:

1. Assignment override (`assignments.land_policy_override_json`) when provided.
2. Service-line default policy (`service_line_policies.policy_json`).
3. Fallback default policy.

## Default Service-Line Policies

Seed defaults live in:

- `docs/seed/service_lines.seed.json`
- `docs/seed/service_line_policies.seed.json`

Current default mapping:

- `VALUATION_LB`: requires `NORMAL_LAND`, `BUILT_UP`; optional `SURVEY_ROWS`
- `VALUATION_PLOT`: requires `NORMAL_LAND`; optional `SURVEY_ROWS`
- `VALUATION_AGRI`: requires `SURVEY_ROWS`; optional `NORMAL_LAND`
- `HOME_LOAN`: requires `NORMAL_LAND`, `BUILT_UP`; optional `SURVEY_ROWS`
- `PROGRESS_COMPLETION`: requires `BUILT_UP`; optional `NORMAL_LAND`
- `LAND_DEVELOPMENT`: requires `NORMAL_LAND`; optional `SURVEY_ROWS`
- `DCC`: requires `NORMAL_LAND`; optional `BUILT_UP`, `SURVEY_ROWS`
- `PROJECT_REPORT`: requires `NORMAL_LAND`; optional `BUILT_UP`, `SURVEY_ROWS`
- `OTHERS`: optional all blocks (description required)

## Validation Rules

- `uom` is mandatory for assignment create/update.
- If service line key is `OTHERS`, `service_line_other_text` is mandatory.
- If effective policy requires `SURVEY_ROWS`, submission without survey rows is rejected.

## Assignment Override & Role Restrictions

- Assignment-level policy override is stored in `land_policy_override_json`.
- Only `ADMIN` and `OPS_MANAGER` can set:
  - `land_policy_override_json`
  - `payment_timing`
  - `payment_completeness`
  - `preferred_payment_mode`
- Non-admin/non-ops users are blocked server-side if they attempt to set these fields.
- Field valuers in draft flow are additionally blocked from admin-only fields.

## Related API Endpoints

- `GET /api/master/service-lines`
- `POST /api/master/service-lines` (admin/ops)
- `PATCH /api/master/service-lines/{id}` (admin/ops)
- `GET /api/master/service-line-policies`
- `PATCH /api/master/service-lines/{id}/policy` (admin/ops)
- `POST /api/assignments`
- `POST /api/assignments/drafts`
- `PATCH /api/assignments/{assignment_id}`
