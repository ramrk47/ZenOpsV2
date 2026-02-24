# Zen Ops - Data Loading Diagnosis & Fix

**Date**: 2026-02-08  
**Issue**: Website loads but no data visible - assignments, clients, master data missing

## Root Causes Identified

### 1. ✅ **Authentication Issue** - FIXED
- **Problem**: Login was failing, returning null token
- **Cause**: Admin password was set during initial setup but not matching expected "admin"
- **Fix**: Updated admin@zenops.local password to "admin"
- **Test**: `curl -X POST http://localhost/api/auth/login -H "Content-Type: application/x-www-form-urlencoded" -d "username=admin@zenops.local&password=admin"`
- **Status**: ✅ Login now works, token generated successfully

### 2. ⚠️ **Empty Database** - PARTIALLY FIXED
- **Problem**: 0 assignments, 0 clients, 0 master data in database
- **Cause**: Seed script checks if admin exists and exits early without seeding other data
- **Status**: 
  - ✅ 5 clients manually inserted
  - ❌ 0 property_types (schema mismatch - missing `code` column)
  - ❌ 0 property_subtypes (depends on property_types)
  - ❌ 0 assignments (multiple schema mismatches)

### 3. ❌ **Schema Mismatches** - CRITICAL
Multiple tables have different schemas than expected by seed scripts:

#### property_types table:
- **Missing**: `code` column (seed expects VARCHAR code like 'RES', 'COM')
- **Has**: id, name, description, is_active, timestamps

#### property_subtypes table:
- **Missing**: `code` column
- **Has**: id, property_type_id, name, description, is_active, timestamps

#### assignments table:
- **Column name**: Uses `assignment_code` not `code`
- **Enum type**: Uses `case_type` enum but actual type name might differ
- **Missing columns**: Several columns seed expects (property_city, property_state, inspection_date)
- **Has extra columns**: bank_id, branch_id, valuer_client_name, site_visit_date, etc.

## Current Database State

```sql
users:               4 rows (admin, finance, emp1, emp2)
clients:             5 rows ✅
property_types:      0 rows ❌
property_subtypes:   0 rows ❌
assignments:         0 rows ❌
```

## API Endpoint Corrections

### ❌ Wrong:
- `/api/clients` (returns 404)

### ✅ Correct:
- `/api/master/clients` (works, returns data)
- `/api/assignments` (works when authenticated)
- `/api/master/property-types`

## Recommended Solution

### Option A: Use Existing Seed Script (Recommended)
The project has `/app/app/seed.py` which knows the correct schema. Run it properly:

```bash
# 1. Enable destructive actions temporarily
docker exec zen-ops-api-1 bash -c 'export DESTRUCTIVE_ACTIONS_ENABLED=true && python -m app.seed --reset'

# OR manually set in .env:
# Add: DESTRUCTIVE_ACTIONS_ENABLED=true to backend/.env

# 2. Rebuild and restart
docker compose restart api

# 3. Run seed
docker exec -w /app zen-ops-api-1 python -m app.seed --reset
```

The seed script will create:
- Master data (clients, property types/subtypes, banks, branches)
- Test users (admin, ops, hr, finance, assistant, field valuers)
- Sample assignments
- Tasks, documents, invoices
- Leave requests

### Option B: Manual SQL Insert (Quick Fix)
Since clients work, continue manually inserting via API:

```bash
TOKEN=$(curl -s -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@zenops.local&password=admin" | jq -r .access_token)

# Create clients via API
curl -X POST http://localhost/api/master/clients \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Client Ltd",
    "client_type": "CORPORATE",
    "contact_name": "John Doe",
    "contact_phone": "+91-9876543210",
    "contact_email": "john@newclient.com"
  }'

# Create assignments via API (check /api/docs for correct schema)
```

### Option C: Schema Investigation (If seed still fails)
```bash
# Check actual table schemas
docker exec zen-ops-db-1 psql -U zenops -d zenops -c "\d property_types"
docker exec zen-ops-db-1 psql -U zenops -d zenops -c "\d assignments"

# Check enum types
docker exec zen-ops-db-1 psql -U zenops -d zenops -c "\dT+"
```

## Immediate Testing

### 1. Verify Login
```bash
curl -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@zenops.local&password=admin"
# Should return: {"access_token": "eyJ...", "user": {...}}
```

### 2. Check Existing Data
```bash
TOKEN="<token from login>"

# Clients (should return 5)
curl -H "Authorization: Bearer $TOKEN" http://localhost/api/master/clients | jq length

# Assignments (currently 0)
curl -H "Authorization: Bearer $TOKEN" http://localhost/api/assignments | jq length
```

### 3. Frontend Check
- Open http://localhost in browser
- Login: admin@zenops.local / admin
- Navigate to Assignments page
- Should see empty state with "No assignments" message (not loading spinner forever)

## Next Steps

1. **Run seed script properly** (Option A above) - This will populate all data with correct schema
2. **Verify in browser** - Check all pages load data correctly
3. **Test Documents V2 feature** - Once data exists, test the new document preview feature

## Login Credentials

After running seed script, use:
- **Admin**: admin@zenops.local / password
- **Ops Manager**: ops@zenops.local / password
- **HR**: hr@zenops.local / password
- **Finance**: finance@zenops.local / password
- **Field Valuer**: field@zenops.local / password

## Files Changed

- ✅ Updated admin password in database
- ✅ Manually inserted 5 test clients
- ❌ Schema mismatches prevent further manual seeding

## Support

If seed script fails with "destructive actions disabled":
1. Check `backend/.env` or `.env.backend`
2. Add or uncomment: `DESTRUCTIVE_ACTIONS_ENABLED=true`
3. Restart API: `docker compose restart api`
4. Re-run seed

---
**Status**: Login fixed ✅, but need to run proper seed script to populate all data
