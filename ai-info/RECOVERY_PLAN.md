# Recovery Plan - Restore Working Database + Keep Documents V2

## Current Situation
- `ai/work` branch has Documents V2 implementation ✅
- But database is empty (seed issues) ❌
- `origin/main` from Jan 27 is stable baseline

## Recovery Strategy

### Option 1: Create New Branch from Main (Recommended)
```bash
cd /Users/dr.156/zen-ops

# 1. Create new branch from stable main
git checkout -b ai/work-clean origin/main

# 2. Cherry-pick ONLY Documents V2 commits (not diagnosis/payroll fixes)
git cherry-pick ac6b919  # Documents V2 main implementation

# 3. Handle any conflicts (migration number might need adjustment)

# 4. Rebuild and restart
docker compose build api frontend
docker compose down
docker compose up -d

# 5. Run seed script (will work on clean main schema)
docker exec -w /app zen-ops-api-1 python -m app.seed --reset

# 6. Test
# Login: admin@zenops.local / password
# Check assignments, clients, master data all present
```

### Option 2: Reset Current Branch to Main + Re-apply
```bash
# Backup current work
git branch ai/work-backup ai/work

# Reset to main
git checkout ai/work
git reset --hard origin/main

# Cherry-pick Documents V2
git cherry-pick ac6b919

# Proceed as above...
```

### Option 3: Database Restore Only (Keep Current Code)
```bash
# Just reset the database and run seed
docker compose down -v  # Remove volumes (WARNING: deletes DB)
docker compose up -d
sleep 20
docker exec -w /app zen-ops-api-1 python -m app.seed --reset
```

## What Gets Preserved

### ✅ Keep (cherry-pick these):
- **ac6b919**: Documents V2 - Preview, Review, Comments
  - Migration 0028_add_document_review_fields
  - DocumentPreviewDrawerV2 component
  - Review workflow
  - Enhanced routes

### ❌ Skip (don't cherry-pick):
- 5e1e909: Data loading diagnosis (temporary doc)
- ea4b4a7: Deployment log (temporary doc)  
- d152944-0f01614: Payroll fixes (if main doesn't have payroll)
- All the login/rate limit fixes (main probably stable)

## Expected Result

After recovery:
- ✅ Working database with seed data (assignments, clients, users, master data)
- ✅ Documents V2 feature integrated
- ✅ Clean git history
- ✅ Login works: admin@zenops.local / password

## Migration Conflict Resolution

If cherry-pick has conflicts on migration `0028`:
```bash
# Check what migration number main is at
git checkout origin/main -- backend/alembic/versions/
ls backend/alembic/versions/ | tail -3

# Adjust your migration number if needed
# e.g., if main is at 0025, rename to 0026_add_document_review_fields
```

## Rollback Plan

If recovery doesn't work:
```bash
# Restore from backup
git checkout ai/work-backup
git branch -D ai/work-clean
git checkout -b ai/work ai/work-backup
```

## Next Steps

1. Choose Option 1 (cleanest)
2. Run the commands
3. Verify data in browser
4. Test Documents V2 feature
5. Delete backup branches if all good

---
**Recommendation**: Go with **Option 1** - clean slate from main + cherry-pick Documents V2
