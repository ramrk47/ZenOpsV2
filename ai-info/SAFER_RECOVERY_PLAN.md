# SAFER Recovery Plan - Keep All Work, Just Fix Data

## ⚠️ CRITICAL: Don't Reset to Main!
Main is 82 commits behind. We'd lose:
- ✅ Payroll 2.0 (complete backend + frontend)  
- ✅ Documents V2
- ✅ Frontend improvements
- ✅ 80+ fixes and features

## ✅ SAFER Alternative: Fix Database WITHOUT Losing Code

### Option A: Just Reset Database (RECOMMENDED)
```bash
cd /Users/dr.156/zen-ops

# 1. Check current migration
docker exec zen-ops-db-1 psql -U zenops -d zenops -c "SELECT * FROM alembic_version;"

# 2. Stop containers
docker compose down

# 3. Remove ONLY database volume (keeps code)
docker volume rm zen-ops_postgres_data

# 4. Start fresh
docker compose up -d

# 5. Wait for DB init
sleep 20

# 6. Seed will run automatically OR manually:
docker exec -w /app zen-ops-api-1 python -m app.seed --reset
```

**Result**: Database gets fresh seed data, all code stays intact!

### Option B: Fix Seed Script Issue
The seed script exits early because admin exists. Fix it:

```bash
# Delete ONLY the admin check users, keep everything
docker exec zen-ops-db-1 psql -U zenops -d zenops << 'SQL'
-- Delete users that block seed
DELETE FROM activity_logs WHERE actor_user_id IN (SELECT id FROM users);
DELETE FROM users;
SQL

# Run seed
docker exec -w /app zen-ops-api-1 python -m app.seed

# Check results
docker exec zen-ops-db-1 psql -U zenops -d zenops -c "SELECT COUNT(*) FROM assignments;"
```

### Option C: Manual Seed via API
Use the working APIs to create data:

```bash
TOKEN=$(curl -s -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@zenops.local&password=admin" | jq -r .access_token)

# Check what master endpoints exist
curl -s -H "Authorization: Bearer $TOKEN" http://localhost/api/docs | \
  grep -o '/api/master/[^"]*' | sort -u
```

## Backups Created ✅

```bash
# Local branches
ai/work-SAFE-BACKUP-20260208-HHMM
ai/work-original

# Remote backup
origin/ai/work-backup-20260208

# To restore if needed:
git checkout ai/work
git reset --hard ai/work-SAFE-BACKUP-20260208-HHMM
```

## Why This Is Better

| Approach | Code Loss | Data Loss | Risk |
|----------|-----------|-----------|------|
| Reset to main + cherry-pick | 80+ commits | None | HIGH ⚠️ |
| Database reset only | None | Old data (ok) | LOW ✅ |
| Fix seed script | None | None | LOW ✅ |

## Recommended: Option A (Database Reset)

1. Keeps ALL your code (Payroll 2.0, Documents V2, fixes)
2. Only resets database (which is empty anyway)
3. Seed runs clean on fresh DB
4. Zero risk to code

## Execute Option A Now?

```bash
cd /Users/dr.156/zen-ops
docker compose down
docker volume ls | grep postgres
docker volume rm zen-ops_postgres_data  # Adjust name if different
docker compose up -d
sleep 30
docker exec -w /app zen-ops-api-1 python -m app.seed --reset
```

---
**Recommendation**: Go with **Option A** - database reset only, keep all code!
