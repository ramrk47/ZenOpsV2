# M4.2 Takeover Handoff

Last updated: 2026-02-12 16:21:16 IST

## Branch and commit state
- Current working branch: `codex/m4-2-people-comms-routing`
- HEAD commit: `3bd91c5f65d2b579954c7d196e19e44b44e49ff1`
- Base branch `main` is at the same commit.
- `origin/main` is also at `3bd91c5f65d2b579954c7d196e19e44b44e49ff1`.

## What is done for M4.2 so far
- M4.2 kickoff started.
- Added new enums in `packages/db/prisma/schema/010_enums.prisma`:
  - `EmployeeRole`
  - `EmployeeStatus`
  - `AttendanceEventKind`
  - `AttendanceEventSource`
  - `PayrollPeriodStatus`
  - `PayrollItemKind`
  - `NotificationEventType`

## Local working tree (important)
There are pre-existing local changes in this repo not created in this handoff step. Do not discard them blindly.

Modified tracked files:
- `apps/api/package.json`
- `apps/api/src/common/request-id.middleware.ts`
- `apps/portal/src/App.tsx`
- `infra/docker/compose.prod.yml`
- `packages/config/src/index.ts`
- `packages/db/prisma/schema/010_enums.prisma` (M4.2 change)
- `turbo.json`

Untracked paths:
- `packages/storage/`

## Remote branches snapshot
- `main` -> `3bd91c5f65d2b579954c7d196e19e44b44e49ff1`
- `codex/active-work` -> `0a83cf334965046060b855cfae6a165cd36f6b17`
- `codex/m3-billable-finalize` local -> `7076cd3ebc21fa3e5aeb81f01daf639bb4519bd8` (ahead of origin)
- `origin/codex/m4-communications-spine` -> `1f00c648ab709135f774c67bd84ebc9ec001f361`
- `codex/m4-demo-staging-ci` -> `70c1f8744d6196a10fd84eca52850f92ab30cf64`

## Recommended continuation plan in next chat
1. Confirm handling strategy for existing unrelated dirty files (keep/commit/stash separately).
2. Implement M4.2 DB layer:
   - add `packages/db/prisma/schema/095_people_payroll.prisma`
   - extend relations in identity/notification models if required.
3. Add RLS policies in `infra/sql/010_rls.sql` for all new people/routing tables.
4. Add seed rows in `infra/sql/020_seed.sql` for target groups/routes.
5. Add API modules/endpoints for employees, attendance, payroll periods, and notification routes.
6. Add tests and contract updates, then run lint/test/contract check.

## Quick commands for the next chat
```bash
git checkout codex/m4-2-people-comms-routing
git status
git diff -- packages/db/prisma/schema/010_enums.prisma
```
