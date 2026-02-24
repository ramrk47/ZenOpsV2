# ZenOps Bug Report - 2026-02-10 00:54

## Summary
Diagnostics collected from Docker containers. Found **3 critical bugs** causing 500 errors.

## Error Counts by Service
| Service | Error Count | Severity |
|---------|-------------|----------|
| api.log | 96 | 🔴 CRITICAL |
| watchdog.log | 852 | 🟡 Medium (expected during startup) |
| grafana.log | 42 | 🟡 Medium (login lockout) |
| db.log | 10 | 🟢 Low |
| email-worker.log | 2 | 🟢 Low |

---

## 🔴 BUG #1: Missing RBAC function `can_manage_support`

**Endpoint:** `GET /api/support/threads`
**Status Code:** 500
**Root Cause:** `AttributeError: module 'app.core.rbac' has no attribute 'can_manage_support'`

**Log Snippet:**
```python
File "/app/app/routers/support.py", line 63, in list_support_threads
    if not rbac.can_manage_support(current_user):
           ^^^^^^^^^^^^^^^^^^^^^^^
AttributeError: module 'app.core.rbac' has no attribute 'can_manage_support'
```

**Fix Location:** `backend/app/core/rbac.py`

**Proposed Fix:**
```python
def can_manage_support(user: models.User) -> bool:
    """Check if user can manage support threads."""
    return user.role in ["admin", "manager", "support"]
```

**Verification:**
```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/support/threads
# Should return 200 with threads list (or empty array)
```

---

## 🔴 BUG #2: Async/await mismatch in document_comments

**Endpoint:** `GET /api/document-comments/`
**Status Code:** 500
**Root Cause:** `TypeError: object ChunkedIteratorResult can't be used in 'await' expression`

**Log Snippet:**
```python
File "/app/app/routers/document_comments.py", line 88, in list_document_comments
    result = await db.execute(query)
             ^^^^^^^^^^^^^^^^^^^^^^^
TypeError: object ChunkedIteratorResult can't be used in 'await' expression
```

**Fix Location:** `backend/app/routers/document_comments.py`, line 88

**Proposed Fix:**
The function is using sync SQLAlchemy session but trying to `await`. Either:
- Remove `await` if using sync session: `result = db.execute(query)`
- Or switch to async session if available

**Verification:**
```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/document-comments/
# Should return 200 with comments list
```

---

## 🔴 BUG #3: UUID/Integer type mismatch in document review

**Endpoint:** `POST /api/assignments/{id}/documents/{id}/review`
**Status Code:** 500
**Root Cause:** `column "reviewed_by_user_id" is of type uuid but expression is of type integer`

**Log Snippet:**
```sql
column "reviewed_by_user_id" is of type uuid but expression is of type integer
LINE 1: ...status='NEEDS_CLARIFICATION', reviewed_by_user_id=29, review...
                                                             ^
HINT:  You will need to rewrite or cast the expression.
```

**Fix Location:** `backend/app/routers/documents.py`, line ~397

**Root Cause Analysis:**
- Database column `reviewed_by_user_id` is UUID type
- Code is passing integer user ID (29) instead of UUID
- Need to convert `current_user.id` to UUID or use the correct user reference

**Proposed Fix:**
```python
# In documents.py review_document function
# Change from:
document.reviewed_by_user_id = current_user.id  # This is an integer

# To:
document.reviewed_by_user_id = current_user.uuid  # Use UUID field
# OR if the column should be integer, fix the migration
```

**Verification:**
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/assignments/45/documents/16/review \
  -H "Content-Type: application/json" \
  -d '{"status": "approved"}'
# Should return 200
```

---

## 🟡 Medium Priority Issues

### Watchdog startup errors (852 errors)
- **Cause:** Watchdog starts before API is ready
- **Impact:** No user impact, just noisy logs during startup
- **Fix:** Add retry logic with longer initial delay

### Grafana login lockout (42 errors)
- **Cause:** Too many failed login attempts
- **Status:** ✅ Fixed by password reset

---

## Fix Priority Order

1. **BUG #1** - Missing `can_manage_support` in rbac.py (blocks support feature)
2. **BUG #3** - UUID type mismatch (blocks document reviews)
3. **BUG #2** - Async mismatch in document_comments (blocks comments feature)

---

## Commands to Apply Fixes

After fixing code:
```bash
# Rebuild and restart API
docker compose up -d api --build

# Collect new logs to verify fixes
./ops/diagnostics/collect_logs.sh

# Check new error count
grep -c "ERROR" ops/diagnostics/*/api.log
```
