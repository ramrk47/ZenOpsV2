# Refactor Plan (Structural, Runnable)

## Goals

1. Move from horizontal router/page sprawl toward domain vertical slices.
2. Keep existing external API behavior stable while reducing long-term coupling.
3. Centralize shared contracts and composition points.

## Target Folder Structure

### Backend target

```text
backend/app/
  core/                 # settings, security, logging, observability, middleware
  shared/               # cross-domain constants/contracts/utils
  modules/
    assignments/
      router.py
      service.py
      repo.py
      schema.py
      permissions.py
      tests/
    documents/
    payroll/
    partners/
    support/
    notifications/
    auth_users/
    admin_masterdata/
  routers/              # transitional compatibility layer, to shrink over time
  models/
  schemas/
```

### Frontend target

```text
frontend/src/
  core/
    api/client.js       # single HTTP client base
    auth/
    router/
    layouts/
  shared/
    contracts/          # route/prefix constants
    ui/
    utils/
  modules/
    assignments/
      pages/
      components/
      api.js
      hooks.js
      schema.js
    documents/
    payroll/
    partners/
    support/
    notifications/
    auth_users/
    admin_masterdata/
  api/                  # transitional re-export layer
```

## What Has Been Implemented in This Pass

1. Backend module registry was introduced:
   - `backend/app/modules/router_registry.py`
   - `backend/app/main.py` now calls `include_all_routers(app)` instead of direct router imports.
2. Backend domain module scaffolds added for all requested domains.
3. Frontend `core` + `shared/contracts` + `modules/*` scaffolds added.
4. Frontend API client moved to `frontend/src/core/api/client.js` with compatibility re-export at `frontend/src/api/client.js`.
5. Backend shared API constants added at `backend/app/shared/contracts.py`.
6. Contract drift tool added (`scripts/contract_check.py`) and contract mismatches fixed.

## Migration Steps (Ordered)

1. Freeze current API behavior with OpenAPI export and contract report.
2. Introduce backend router composition registry (completed).
3. Introduce backend domain module skeletons and route aggregation (completed).
4. Move cross-domain constants into `backend/app/shared` and `frontend/src/shared/contracts` (completed baseline).
5. Move frontend HTTP client to `frontend/src/core/api/client.js` and keep backward compatibility alias (completed).
6. For each domain, progressively migrate:
   - router handler logic from `backend/app/routers/*.py` into `modules/<domain>/service.py` + `repo.py`
   - schema ownership from global schema files into `modules/<domain>/schema.py`
   - permission checks into `modules/<domain>/permissions.py`
7. Keep `backend/app/routers/*` as thin wrappers during migration; remove only after parity tests pass.
8. Migrate frontend domain by domain:
   - page-specific API calls from `frontend/src/api/*` into `frontend/src/modules/<domain>/api.js`
   - shared hooks/types into domain `hooks.js`/`schema.js`
   - replace imports in pages/components gradually.
9. Enforce contract check in CI using `python3 scripts/contract_check.py --strict`.
10. Final cleanup:
   - remove dead wrappers
   - verify no circular imports
   - update docs/runbooks.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Router prefix drift during move | Frontend 404s | Keep OpenAPI export + contract check as gate |
| Circular imports from incremental module moves | Runtime import failures | Keep strict layering (`router -> service -> repo`) and shared-only constants |
| Permission divergence (RBAC) | Security regressions | Centralize permission helpers and avoid inline ad-hoc checks |
| Partner portal data leakage | High severity auth bug | Preserve partner-only filters and role checks before query execution |
| Long-lived branch drift | Merge pain | Migrate in small commits, rerun contract check each step |
| Data model churn | Migration/runtime failures | No destructive DB migration in this pass; preserve existing tables/volumes |

## Rollback Notes

1. Code rollback: revert specific refactor commits in reverse order (router registry first, then module scaffold usage).
2. Runtime rollback: deploy previous image tag while keeping same DB volumes.
3. Database rollback: not required for this pass because no destructive schema changes were introduced.
4. Emergency API rollback: restore `backend/app/main.py` explicit `app.include_router(...)` list if module registry causes boot issue.

## Justification for Changes

- Module registry decouples app startup from a large direct import block and creates a controlled assembly point.
- Domain scaffolds provide a safe migration path without forcing a big-bang rewrite.
- Shared API contract constants reduce prefix duplication and frontend/backend drift.
- Automated contract report/check converts manual endpoint matching into a repeatable gate.
