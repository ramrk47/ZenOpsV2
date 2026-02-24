# M5.3 Monorepo Bridge Handoff

Last updated: 2026-02-24 (Asia/Kolkata)

## Purpose
This handoff documents the **repo layout change** that brings V1 into the V2 repository as a
controlled subtree for coordinated Repogen-era changes.

This is a **monorepo bridge**, not a platform merge.

## Branch and checkpoint state
- Repo: `/Users/dr.156/ZenOpsV2`
- Branch: `codex/m5-3-monorepo-bridge`
- Base branch for comparison: `codex/m4-6-masterdata-lifecycle`
- `main` remains untouched/stable (still the correct release/integration branch)

Pre-import checkpoint tags:
- V2 tag: `m5.2-handoff`
- V1 tag: `v1-billing-monitor-handoff`

## What changed in this branch

### 1) Imported V1 as a legacy subtree
- Source repo: `/Users/dr.156/zen-ops`
- Source branch: `ai/work`
- Import path: `/Users/dr.156/ZenOpsV2/legacy/v1/`
- Import method: `git subtree add --prefix=legacy/v1 /Users/dr.156/zen-ops ai/work --squash`

Subtree import commits:
- `6ea7202` `Squashed 'legacy/v1/' content from commit c1b3d78`
- `590598c` `Merge commit '6ea72023ede2cf3116e1c7983722be8980d01780' as 'legacy/v1'`

### 2) Added hard boundaries documentation
- `/Users/dr.156/ZenOpsV2/docs/BOUNDARIES_V1_V2.md`

This document defines:
- ownership split (V2 billing truth vs V1 legacy ops)
- non-negotiable DB separation
- allowed integration paths (HTTP/events only)
- forbidden patterns (cross-DB SQL, shared migrations, shared envs)

### 3) Added root bridge wrapper scripts
- `/Users/dr.156/ZenOpsV2/scripts/dev-v1.sh`
- `/Users/dr.156/ZenOpsV2/scripts/dev-v2.sh`
- `/Users/dr.156/ZenOpsV2/scripts/smoke-v1.sh`

### 4) Added root package scripts (convenience)
Updated:
- `/Users/dr.156/ZenOpsV2/package.json`

New commands:
- `pnpm dev:v1`
- `pnpm dev:v2`
- `pnpm smoke:v1`
- `pnpm smoke:v2`
- `pnpm docker:test:v1`

### 5) Compatibility fix applied inside imported V1 subtree
Updated:
- `/Users/dr.156/ZenOpsV2/legacy/v1/scripts/docker-test.sh`

Reason:
- imported V1 compose validation expects local `.env.backend` and `.env.frontend`
- script now temporarily bootstraps them from examples during `docker compose config -q`

## Validation run after import (completed)

Passed:
1. `pnpm docker:test`
2. `bash legacy/v1/scripts/docker-test.sh`
3. `bash scripts/dev-v1.sh config -q`
4. `bash scripts/dev-v2.sh config -q`

## Repo layout (current)

High-level shape:
- V2 apps remain in `/Users/dr.156/ZenOpsV2/apps/`
- V1 legacy code now lives in `/Users/dr.156/ZenOpsV2/legacy/v1/`

Key rule:
- V1 and V2 are co-located for code review and coordinated changes, but runtime/data boundaries remain separate.

## Recommended next step
Create the actual Repogen implementation branch from this bridge:

```bash
cd /Users/dr.156/ZenOpsV2
git checkout codex/m5-3-monorepo-bridge
git pull --rebase origin codex/m5-3-monorepo-bridge
git checkout -b codex/m5-3-repogen-spine
git push -u origin codex/m5-3-repogen-spine
```

## Merge guidance
- Treat this branch as a structural/change-management PR first.
- Do not mix large Repogen feature implementation into the same PR as the subtree import if reviewability matters.
- Keep `main` as the release-integrated branch; merge only after validation and boundary review.
