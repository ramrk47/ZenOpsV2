# Claude Handoff (Zen Ops)

Date: 2026-02-07
Branch: codex/deploy-ready-20260205_1530

## Snapshot
- Working tree: clean.
- Local branch is ahead by 8 commits; not pushed yet.
- Deployment is **not** to be executed today (user asked to deploy tomorrow).

## What’s Already Implemented
- Multi-role user model with capability union and partner single-role enforcement.
- Expanded backend services: approvals, notifications, invoices, partner portal, backups, analytics, tasks.
- Expanded frontend admin + partner UIs (backups, notification deliveries, partner detail, UI revamps).
- Production deploy scaffolding (Docker Compose, Caddy, backup scripts, restore checklist).
- AI continuity docs: log, project map, git workflow, ADRs, changelog.

## Current Source of Truth (read these first)
- `/Users/dr.156/zen-ops/docs/PROJECT_MAP.md`
- `/Users/dr.156/zen-ops/docs/AI_ENGINEERING_LOG.md`
- `/Users/dr.156/zen-ops/docs/GIT_WORKFLOW.md`
- `/Users/dr.156/zen-ops/docs/ADR/`
- `/Users/dr.156/zen-ops/README_DEPLOY.md`

## Required Practices
- Append to `/Users/dr.156/zen-ops/docs/AI_ENGINEERING_LOG.md` for any meaningful change.
- Follow Conventional Commits for commit messages.
- No force-push, no history rewrite, preserve branches/tags.

## Open Tasks / Next Steps
1. **Login protocol updates** pending user decision (MFA, password policies, reset rules).
2. **User data refresh** pending user-provided roster and role assignments.
   - Multi-role is supported (e.g., HR + Finance). External partners must remain single-role.
3. **Deployment go-live** scheduled for tomorrow. Ensure:
   - `.env` values are set (JWT_SECRET, ALLOW_ORIGINS, VITE_API_URL, CADDY_SITE, LETSENCRYPT_EMAIL, BACKUP_ENCRYPTION_KEY).
   - Run migrations: `alembic upgrade head`.
   - Verify `/readyz` returns the migration revision.
   - Ensure backup job runs and restore script is tested.
4. **ADR stubs** (ADR-0002/0003/0004) still TODO.

## Quick Commands
- Repo hygiene check: `scripts/verify_repo_hygiene.sh`
- Add log entry: `scripts/new_log_entry.sh`
- Backend migrations: `cd backend && alembic upgrade head`
- Backend seed: `cd backend && python -m app.seed`
- Notification worker: `python -m app.scripts.notification_worker --interval 30`
- Smoke test: `./scripts/validate.sh`

## Deployment Notes
- Docker Compose uses Caddy reverse proxy and optional backup profile.
- Backups: encrypted offsite; `BACKUP_ENCRYPTION_KEY` is required.
- Restore checklist: `/Users/dr.156/zen-ops/deploy/backup/RESTORE_TEST_CHECKLIST.md`.

## Known Constraints / Risks
- DB migrations 0011–0017 are now in repo and must be applied in order.
- Some routes rely on role-based notifications and approval routing; verify with staging data.
- Multiple “other chat” changes were integrated and committed; review AI log for detail.

## Contact / User Guidance
- User will provide actual user roster and login protocol requirements soon.
- User explicitly said deployment is **tomorrow**, not today.

