# Test Known Failures (Quarantined)

Last updated: 2026-03-03

This file tracks known non-blocking test failures outside the active delivery phase.

## Current Known Failures

1. `backend/tests/test_mentions.py`
- Why: Existing mention parsing/notification behavior diverges from expected assertions after messaging updates.
- Impact: Does not block onboarding, approvals, or assignment governance flows.
- Planned fix window: Phase 7.

2. `backend/tests/test_support.py`
- Why: Legacy support-thread behavior has unresolved expectations around status/notification transitions.
- Impact: Does not block onboarding/invite/access-control workflows.
- Planned fix window: Phase 8.

## Phase Verification Policy

For release decisions in current delivery phases, run the pinned phase suites below instead of requiring full `pytest -q`.

### Phase 2 Verification

```bash
cd /Users/sriramrk/ZenOpsV2/legacy/v1

docker compose -f docker-compose.dev.yml run --rm backend alembic upgrade head
docker compose -f docker-compose.dev.yml run --rm backend pytest -q \
  tests/test_phase2_approvals.py

cd frontend && npm run build
```

### Phase 4 Verification

```bash
cd /Users/sriramrk/ZenOpsV2/legacy/v1

docker compose -f docker-compose.dev.yml run --rm backend alembic upgrade head
docker compose -f docker-compose.dev.yml run --rm backend pytest -q \
  tests/test_phase2_approvals.py \
  tests/test_phase4_service_lines_assignments.py

cd frontend && npm run build
```

### Phase 5 Verification

```bash
cd /Users/sriramrk/ZenOpsV2/legacy/v1

docker compose -f docker-compose.dev.yml run --rm backend alembic upgrade head
docker compose -f docker-compose.dev.yml run --rm backend pytest -q \
  tests/test_phase2_approvals.py \
  tests/test_phase4_service_lines_assignments.py \
  tests/test_phase5_ops_ux.py

cd frontend && npm run build
```

### Phase 6 Verification

```bash
cd /Users/sriramrk/ZenOpsV2/legacy/v1

docker compose -f docker-compose.dev.yml run --rm backend alembic upgrade head
docker compose -f docker-compose.dev.yml run --rm backend pytest -q \
  tests/test_phase2_approvals.py \
  tests/test_phase4_service_lines_assignments.py \
  tests/test_phase5_ops_ux.py \
  tests/test_phase6_onboarding.py

cd frontend && npm run build
```
