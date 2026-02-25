# V1 / V2 Boundaries (Monorepo Bridge)

Last updated: 2026-02-24 (Asia/Kolkata)

## Purpose
This repository now contains:
- V2 (current control plane + future unified platform)
- V1 (legacy operational engine) imported under `legacy/v1/`

This is a **monorepo bridge**, not a system merge.

## Ownership split (hard boundary)

### V2 (authoritative for billing truth)
Location:
- `/Users/dr.156/ZenOpsV2/apps/*`

V2 owns:
- billing policy (`POSTPAID` vs `CREDIT`)
- credit balances / ledger / reservations
- subscription state and refill lifecycle
- billing/payment webhook events and timeline
- control plane admin operations (Studio)

### V1 (legacy operational engine, still active)
Location:
- `/Users/dr.156/ZenOpsV2/legacy/v1`

V1 owns (until migrated off):
- operational postpaid invoice workflow used by current staff/customers
- legacy admin/staff UX
- external associate/referral operational flows tied to current production usage

## DB separation policy (non-negotiable)
- V1 and V2 use separate databases.
- No cross-DB SQL writes.
- No shared migrations.
- No shared Alembic/Prisma schema management.

Allowed integration path:
- HTTP API calls (e.g. V1 -> V2 billing endpoints via service token)
- Event/webhook ingestion

Forbidden patterns:
- V1 code reading/writing V2 DB directly
- V2 code reading/writing V1 DB directly
- shared connection strings
- shared transaction boundaries across systems

## Compose / env separation
- V2 compose files remain in V2 root (`infra/docker/*`)
- V1 compose files remain inside `legacy/v1/`
- V1 and V2 keep separate `.env` files
- V1 and V2 keep separate smoke/validation scripts

Wrapper scripts at repo root (for convenience only):
- `scripts/dev-v1.sh`
- `scripts/dev-v2.sh`
- `scripts/smoke-v1.sh`
- existing `scripts/smoke-v2.sh`

These wrappers must not blur runtime ownership or env separation.

## Development rules for cross-cutting changes (Repogen era)
When a change touches both V1 and V2:
1. Keep code changes scoped to their respective folders (`legacy/v1` vs V2 apps)
2. Document the interface contract (request/response/event payload)
3. Validate both stacks independently
4. Use `/v1/meta` identity checks in smoke scripts to avoid wrong-target testing

## Migration direction (strategic)
- Direction of travel is V1 -> V2 feature migration over time.
- Importing V1 here is for coordination and safer cross-system change review.
- Importing V1 here does **not** change system-of-record ownership today.
