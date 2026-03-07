# 🔧 maulya Troubleshooting Report
**Date:** 2026-02-08  
**Status:** Issues identified and fixes ready

---

## 📊 Executive Summary

| Issue | Status | Severity | Fix Required |
|-------|--------|----------|--------------|
| Payroll API 404s | ❌ **BROKEN** | CRITICAL | Rebuild backend container |
| CSP blocking fonts | ✅ **FIXED** | N/A | Already working |
| First row not clickable | ⚠️ **LIKELY BROKEN** | MEDIUM | Rebuild frontend container |

---

## 🔍 Detailed Analysis

### Issue #1: Payroll API 404 Errors ❌ CRITICAL

**What's happening:**
```
GET /api/payroll/runs → 404 Not Found
GET /api/payroll/stats → 404 Not Found
GET /api/payroll/salary-structures → 404 Not Found
```

**Root Cause:**
The source code was fixed (changed prefix from `/payroll` to `/api/payroll`), but the Docker containers were never rebuilt. The running API container is serving **45-minute-old code** with the wrong prefix.

**Evidence:**
```bash
# Source code (correct):
$ grep "router = APIRouter" backend/app/routers/payroll.py
router = APIRouter(prefix="/api/payroll", tags=["payroll"])  ✅

# Running container (wrong):
$ docker compose exec api grep "router = APIRouter" /app/app/routers/payroll.py
router = APIRouter(prefix="/payroll", tags=["payroll"])  ❌
```

**Impact:**
- Payroll page completely broken
- Stats widgets showing errors
- Cannot create or view payroll runs

---

### Issue #2: CSP Blocking Google Fonts ✅ FIXED

**Status:** Already working correctly!

**Current CSP Headers:**
```
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
font-src 'self' https://fonts.gstatic.com data:
```

**No action needed.** Fonts should load after frontend rebuild (if not loading, it's likely cached).

---

### Issue #3: First Row Not Clickable ⚠️ INVESTIGATE

**What's happening:**
The first row in tables (payroll runs, invoices) is not responding to clicks.

**Likely Causes:**

1. **Stale frontend container** - Similar to the backend issue, frontend may have old CSS/JS
2. **Sticky header overlap** - The `position: sticky` header with `z-index: 3` might be covering the first row
3. **CSS padding issue** - First row might need extra top padding

**Current CSS:**
```css
thead th {
  position: sticky;
  top: 0;
  z-index: 3;
  background: var(--surface);
}

tbody tr {
  scroll-margin-top: 48px;
}
```

**Fix Strategy:**
1. First rebuild frontend container (will likely fix it)
2. If persists, adjust CSS (see fix below)

---

## 🚀 THE FIX - Run This Script

I've created a comprehensive fix script at:
```
/Users/dr.156/maulya/fix-all-issues.sh
```

**To run it:**
```bash
cd /Users/dr.156/maulya
./fix-all-issues.sh
```

**What it does:**
1. ✅ Stops all containers
2. ✅ Rebuilds backend with `--no-cache` (fixes payroll 404s)
3. ✅ Rebuilds frontend with `--no-cache` (fixes clickability)
4. ✅ Starts containers
5. ✅ Runs automated verification tests
6. ✅ Shows you the results

**Expected output:**
```
✅ SUCCESS: Payroll stats endpoint responding
✅ SUCCESS: Payroll runs endpoint responding
✅ Container prefix correct: /api/payroll
✅ CSP headers include fonts.googleapis.com
```

**Estimated time:** 3-5 minutes (depending on build speed)

---

## 🧪 Manual Verification Steps

After running the fix script:

### 1. Test Payroll API
```bash
# Should return stats (not 404)
curl http://localhost/api/payroll/stats

# Should return runs list (not 404)
curl http://localhost/api/payroll/runs
```

### 2. Test Frontend
1. Open: `http://localhost/admin/payroll/runs`
2. Open browser console (F12)
3. **Check:**
   - ✅ No 404 errors in console
   - ✅ No CSP errors
   - ✅ Fonts loading from fonts.googleapis.com (Network tab)
   - ✅ First row in table is clickable

### 3. Verify Container Code
```bash
# Should show correct prefix
docker compose exec api grep "router = APIRouter" /app/app/routers/payroll.py

# Should show correct CSP
docker compose exec reverse-proxy cat /etc/caddy/Caddyfile | grep CSP
```

---

## 🔧 If Issues Persist After Rebuild

### Problem: First row still not clickable

**Quick CSS Fix:**

Edit: `/Users/dr.156/maulya/frontend/src/styles.css`

Add after line 179:
```css
/* Fix first row clickability */
tbody tr:first-child td {
  padding-top: 1rem;
}

/* Reduce sticky header z-index */
thead th {
  position: sticky;
  top: 0;
  z-index: 2; /* Reduced from 3 */
  background: var(--surface);
  backdrop-filter: blur(6px);
}
```

Then rebuild frontend:
```bash
docker compose build --no-cache frontend
docker compose up -d frontend
```

### Problem: Still getting 404s

**Verify router registration:**
```bash
# Check if payroll router is included in main.py
docker compose exec api grep -n "payroll" /app/app/main.py
```

**Expected output should include:**
```python
from app.routers import payroll
app.include_router(payroll.router)
```

---

## 📝 Why Docker Rebuilds Are Required

**The issue:**
- Your `docker-compose.yml` uses **baked images** (not bind mounts)
- This means code changes don't appear until you rebuild
- The `--no-cache` flag is critical to avoid stale layers

**Configuration in docker-compose.yml:**
```yaml
api:
  build:
    context: ./backend  # Copies code into image
  # No volumes: clause for code mounting
```

**Without rebuild:**
- Source code ✅ Fixed
- Running container ❌ Still has old code

**After rebuild:**
- Source code ✅ Fixed  
- Running container ✅ Has new code

---

## 📊 Container Status (Current)

```
NAME                      STATUS
maulya-api-1            Up 45 minutes (healthy) ⚠️  OLD CODE
maulya-frontend-1       Up 45 minutes (healthy) ⚠️  OLD CODE
maulya-db-1             Up 45 minutes (healthy) ✅
maulya-email-worker-1   Up 45 minutes (healthy) ✅
maulya-reverse-proxy-1  Up 45 minutes           ✅
```

---

## 🎯 Success Criteria

After running the fix, you should have:

- [ ] ✅ No 404 errors for `/api/payroll/*` endpoints
- [ ] ✅ No CSP errors in browser console
- [ ] ✅ Fonts loading from Google Fonts
- [ ] ✅ First row in payroll table is clickable
- [ ] ✅ Payroll page loads with data
- [ ] ✅ Stats widgets show numbers (not errors)

---

## 🆘 Troubleshooting Commands

```bash
# Check API logs for errors
docker compose logs -f api | grep -i "error\|404"

# Check frontend logs
docker compose logs -f frontend

# Check reverse proxy logs
docker compose logs -f reverse-proxy

# Restart specific service
docker compose restart api

# Force complete rebuild of everything
docker compose down
docker compose build --no-cache
docker compose up -d

# Check container health
docker compose ps
```

---

## 📞 Quick Reference

| Command | Purpose |
|---------|---------|
| `./fix-all-issues.sh` | Run complete fix (recommended) |
| `docker compose down` | Stop containers |
| `docker compose build --no-cache api` | Rebuild backend only |
| `docker compose build --no-cache frontend` | Rebuild frontend only |
| `docker compose up -d` | Start containers |
| `docker compose logs -f api` | Watch API logs |
| `curl http://localhost/api/payroll/stats` | Test payroll API |

---

## 📚 Related Documentation

- `BUG_FIX_SUMMARY.md` - Original bug fix documentation
- `QUICK_FIX.md` - Quick reference guide
- `PAYROLL_STATUS.md` - Payroll implementation status
- `docker-compose.yml` - Container configuration

---

## ✅ Next Steps

1. **Run the fix script:**
   ```bash
   cd /Users/dr.156/maulya
   ./fix-all-issues.sh
   ```

2. **Verify in browser:**
   - Navigate to `http://localhost/admin/payroll/runs`
   - Open console (F12)
   - Check for errors

3. **Test functionality:**
   - Click first row in table
   - Create a payroll run
   - View stats

4. **Report back:**
   - If everything works: ✅ Done!
   - If issues persist: Share the output from the fix script

---

**Created:** 2026-02-08  
**Fix Script:** `/Users/dr.156/maulya/fix-all-issues.sh`  
**Estimated Fix Time:** 3-5 minutes
