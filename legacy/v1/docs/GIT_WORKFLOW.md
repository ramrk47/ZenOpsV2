# Git Workflow (Zen Ops)

## Non-Negotiables
- Do not reinitialize git.
- Do not rewrite history or force-push.
- Preserve branches, tags, and the current commit graph.

## Branch Naming Conventions
- `main` (protected mental model; stable integration).
- `feat/<topic>` for feature work.
- `fix/<topic>` for bug fixes.
- `chore/<topic>` for maintenance.
- `snapshot/<milestone-date>` for snapshots before risky changes or AI tool switches.

## Snapshot Protocol
Use snapshots before big refactors, data migrations, or switching AI tools.
- Create snapshot branch:
  - `git branch snapshot/2026-02-07-baseline`
- Create annotated tag:
  - `git tag -a snapshot-2026-02-07-baseline -m "Snapshot before refactor"`
- Push branch and tag:
  - `git push origin snapshot/2026-02-07-baseline`
  - `git push origin snapshot-2026-02-07-baseline`

Restore example using a real commit hash from this repo:
- `git switch -c restore/2026-02-07 2e117f9a8e572b7f84b12f45d00cccd6202ed530`
- `git push origin restore/2026-02-07`

## Commit Protocol
- Use Conventional Commits:
  - `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`.
- Keep commits small and focused.
- Avoid bundling unrelated changes into a single commit.

## Merge Protocol
- Preferred approach: merge commits into `main` to preserve full context.
- Rebase is allowed only on local, unpushed feature branches.
- Never rebase or force-push shared branches.

## Repo Hygiene
- Do not commit `.env` or secrets.
- Do not track `backend/.venv` or `frontend/node_modules`.

If any of these are tracked, remove them safely:
- `git rm --cached -r backend/.venv`
- `git rm --cached -r frontend/node_modules`
- `git rm --cached .env .env.*`
- `git commit -m "chore: remove tracked environment artifacts"`

## Optional: Git Worktree for Parallel Work
Use worktrees to isolate multiple AI tool changes without branch collisions.
- `git worktree add ../zen-ops-feat-xyz feat/xyz`
- `git worktree add ../zen-ops-fix-abc fix/abc`
- `git worktree list`
- `git worktree remove ../zen-ops-feat-xyz`
