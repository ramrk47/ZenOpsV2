# Phase 7 Allocation Runbook and Tuning Guide

## Purpose
Phase 7 introduces policy-driven assignment allocation for V1 (`legacy/v1`) with:
- Service-line assignee eligibility checks (server-enforced)
- Workload-based candidate scoring
- One-click `Assign Best Candidate`
- Admin-editable allocation policy JSON per service line
- Optional per-user allocation eligibility overrides

## Scope Boundaries
- Role enums remain unchanged (`FINANCE`, `HR`, `OPS_MANAGER`, etc.)
- No external allocation service dependencies
- V2 sidecar code is not part of this runbook

## Operator Checklist
1. Confirm migration is applied:
   - `service_lines.allocation_policy_json`
   - `users.allocation_prefs_json`
2. Validate service line policy JSON in Admin Master Data.
3. Validate personnel eligibility toggles from Personnel page.
4. Test `Assign Best Candidate` on a real pending assignment.
5. Confirm ineligible assignee mutations fail with `ASSIGNEE_NOT_ELIGIBLE`.

## Default Allocation Policy
If service-line `allocation_policy_json` is empty, defaults are used:

```json
{
  "eligible_roles": ["ADMIN", "OPS_MANAGER", "ASSISTANT_VALUER", "FIELD_VALUER", "EMPLOYEE"],
  "deny_roles": ["FINANCE", "HR"],
  "weights": {
    "open_assignments": 3,
    "overdue_tasks": 8,
    "due_soon": 4,
    "inactive_penalty": 6,
    "field_valuer_bias": -2
  },
  "max_open_assignments_soft": 12
}
```

## Eligibility Rules (Server Truth)
1. Primary-role deny is enforced (`FINANCE`, `HR`) for internal operational queues.
2. `EXTERNAL_PARTNER` is blocked from internal assignment queues.
3. Assignment write mutations validate assignees and reject with:

```json
{
  "code": "ASSIGNEE_NOT_ELIGIBLE",
  "user_id": 123,
  "reason": "PRIMARY_ROLE_DENY",
  "message": "Primary role FINANCE is not eligible for operational assignment allocation"
}
```

## Workload Scoring
Lower score is better.

Signals:
- `open_assignments`
- `overdue_tasks`
- `due_soon` (next 48h)
- `last_active_minutes` (inactive penalty threshold: 120m)
- `field_valuer_bias` (optional negative bias for site-visit assignments)

Score formula:

```text
score =
  open_assignments * weights.open_assignments +
  overdue_tasks * weights.overdue_tasks +
  due_soon * weights.due_soon +
  inactive_penalty(if last_active_minutes is null or >120) +
  field_valuer_bias(if site_visit_date is set and user is FIELD_VALUER)
```

## Tuning Guidance
1. Increase `overdue_tasks` weight if deadline misses are frequent.
2. Increase `open_assignments` weight when queue balancing is poor.
3. Increase `inactive_penalty` if stale users are getting allocations.
4. Make `field_valuer_bias` more negative when site visits should prioritize field staff.
5. Raise/lower `max_open_assignments_soft` to adjust overload warning sensitivity.

## Example Aggressive-Balancing Policy
```json
{
  "eligible_roles": ["OPS_MANAGER", "ASSISTANT_VALUER", "FIELD_VALUER", "EMPLOYEE"],
  "deny_roles": ["FINANCE", "HR"],
  "weights": {
    "open_assignments": 6,
    "overdue_tasks": 10,
    "due_soon": 5,
    "inactive_penalty": 8,
    "field_valuer_bias": -2
  },
  "max_open_assignments_soft": 10
}
```

## Verification Commands
```bash
cd legacy/v1
docker compose -f docker-compose.dev.yml run --rm backend alembic upgrade head
docker compose -f docker-compose.dev.yml run --rm backend pytest -q \
  tests/test_phase2_approvals.py \
  tests/test_phase4_service_lines_assignments.py \
  tests/test_phase5_ops_ux.py \
  tests/test_phase6_onboarding.py \
  tests/test_phase7_allocation.py

cd frontend && npm run build
```

## Troubleshooting
- `ASSIGNEE_NOT_ELIGIBLE` on manual assignment:
  - Check service-line `deny_roles` and `eligible_roles`.
  - Check user primary role and allocation preferences.
- Candidate list looks empty:
  - Validate service-line policy JSON schema.
  - Verify there are active internal users matching `eligible_roles`.
- Unexpected ranking:
  - Inspect candidate `signals` payload from `/allocation/candidates`.
  - Confirm policy weights are what you expect after save.
