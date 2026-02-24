You are my background code auditor. I want a deep audit of the entire Zen Ops repo, but you must NOT open or read any .env* files or output secrets.

Goal: Find bugs, inconsistencies, edge cases, security issues, missing routes, broken imports, wrong role names, mismatched frontend-backend contracts, and deployment footguns. Produce a prioritized report + a concrete fix plan.

Hard constraints:
- Do NOT open/read: **/.env, **/.env.*, any secrets files.
- Do NOT modify code yet. Audit first. After the report, wait for my “APPLY FIXES” instruction.
- Exclude generated folders from scanning: node_modules, dist, build, .git, __pycache__, .venv, deploy/backups, uploads, postgres volumes.

Audit method (must be systematic):
1) Create a full file inventory (tree) and count files by area: backend/app, frontend/src, deploy, scripts, migrations.
2) Run repo-level static checks using terminal:
   - docker compose config (validate compose)
   - backend: run tests if present; otherwise run import check + lint if available
   - frontend: run typecheck/lint/build if available
3) Read code area-by-area and log issues with exact file paths + line numbers:
   A) Backend FastAPI: routers mounted? path prefixes correct? auth deps consistent? role checks consistent? missing endpoints returning 404?
   B) DB/migrations: Alembic heads consistent? non-destructive? upgrade/downgrade safe? naming collisions?
   C) Documents system: preview/download security, comment lanes, permissions, potential path traversal, file handling errors.
   D) Frontend: API baseURL, endpoints match backend, error states, role-based UI restrictions, documents tab logic, templates pull logic consistency.
   E) Docker/deploy: volumes safety, no down -v, migration flow, backup profile correctness, rclone config path correctness, healthchecks.
4) Classify every issue:
   - Severity: Blocker / High / Medium / Low
   - Type: Bug / Security / Reliability / UX / DevEx
   - Fix effort: S/M/L
   - Proposed fix (short)

Deliverables:
- A single markdown report “AUDIT_REPORT.md” with:
  - Executive summary (top 10 blockers)
  - Detailed findings grouped by subsystem
  - “Most likely production outages” list (top 5)
  - Quick wins (top 10)
  - A staged fix plan: Phase 1 (stability), Phase 2 (security), Phase 3 (polish)
- At the end, ask me whether to proceed with “APPLY FIXES” and which phase first.

Important: treat .env values as unknown and don’t assume secrets. If you need config values, ask me for specific keys only (not values).