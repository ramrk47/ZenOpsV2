# Zen Ops - Testing Checklist for Document Preview Fixes

## Overview
This checklist validates the 3 critical bug fixes implemented:
1. **Async/await removal** - Sync database operations (document_comments.py, documents.py)
2. **Missing highlightMentions function** - Frontend mention rendering (DocumentComments.jsx)
3. **Detached instance fix** - Transaction order in review endpoint (documents.py)

## Prerequisites
- Services running: `docker compose ps` shows api, frontend, db as healthy
- Test user credentials available
- Sample assignment with documents uploaded
- Browser DevTools console open (to catch JS errors)

---

## Test Suite

### 1. Document Review Workflow (Core Functionality)

**Objective**: Verify document status changes work without SQLAlchemy errors

**Steps**:
1. Navigate to an assignment with uploaded documents
2. Click on a document to open preview drawer
3. Change review status using dropdown:
   - Set to "APPROVED"
   - Wait for save confirmation
4. Change to "NEEDS_CLARIFICATION"
   - Wait for save confirmation
5. Change to "REJECTED"
   - Wait for save confirmation
6. Refresh page and verify status persists

**Expected Results**:
- ✅ Status updates successfully on each change
- ✅ No 500 errors in network tab
- ✅ No SQLAlchemy "detached instance" errors in API logs
- ✅ Status persists after page refresh

**Backend Logs Check**:
```bash
docker logs zen-ops-api-1 --tail 100 | grep -E "(ERROR|detached|f405)"
```
Should return no matches.

---

### 2. Comment Creation (Database Operations)

**Objective**: Verify comment posting works with synchronous database operations

**Steps**:
1. Open document preview drawer
2. Scroll to comments section at bottom
3. Type a test comment: "Testing comment creation"
4. Click "Post Comment" button
5. Verify comment appears immediately
6. Add another comment with multi-line text
7. Refresh page and check comments persist

**Expected Results**:
- ✅ Comments post immediately without errors
- ✅ No 401 Unauthorized errors (auth fixed)
- ✅ No async/await errors in API logs
- ✅ Comments persist after refresh

**Network Tab Check**:
- POST `/api/document-comments` returns 200/201
- Response includes comment ID and timestamp

---

### 3. @Mentions in Comments (New Feature)

**Objective**: Verify mention parsing, highlighting, and notifications

**Steps**:
1. Create a comment with email mention: "Hey @user@example.com please review"
2. Verify:
   - Mention is highlighted in blue background
   - Badge shows "mentions: 1"
3. Create comment with name mention: "cc @John Doe"
4. Create comment with multiple mentions: "@user1@example.com and @Jane Smith"
5. Check target user's notifications for mention alerts

**Expected Results**:
- ✅ Mentions highlighted with blue background in comment display
- ✅ Mention badge shows correct count
- ✅ No "highlightMentions is not defined" errors in console
- ✅ Mentioned users receive notifications (check DB or notifications panel)

**Backend Logs Check**:
```bash
docker logs zen-ops-api-1 --tail 100 | grep "mentioned_user_ids"
```
Should show resolved user IDs.

---

### 4. Review with Notes (Combined Workflow)

**Objective**: Verify review status change + comment creation in single transaction

**Steps**:
1. Open document preview drawer
2. Change status to "NEEDS_CLARIFICATION"
3. In the notes field, add: "Please fix section 3 and re-upload. cc @reviewer@example.com"
4. Click "Save Review" button
5. Verify:
   - Status changes to NEEDS_CLARIFICATION
   - Review note appears as comment
   - Mention is highlighted in the note
6. Check API logs for transaction success

**Expected Results**:
- ✅ Status updates successfully
- ✅ Review note saved as comment
- ✅ Mentions in notes are parsed and highlighted
- ✅ No detached instance errors
- ✅ Transaction completes atomically (both status + comment saved)

**Critical**: This tests the fix for detached instance error!

---

### 5. Comment Resolution (Toggle Feature)

**Objective**: Verify comment resolution works with sync operations

**Steps**:
1. Find an existing comment
2. Click "Mark as Resolved" button/checkbox
3. Verify comment shows as resolved (grayed out or strikethrough)
4. Click "Unresolve" to toggle back
5. Refresh and verify resolution status persists

**Expected Results**:
- ✅ Resolution status toggles immediately
- ✅ No async errors in logs
- ✅ Status persists after refresh

---

### 6. Stress Test: Rapid Operations

**Objective**: Verify no race conditions or detached instance issues under load

**Steps**:
1. Rapidly change document status 5 times in a row:
   - APPROVED → NEEDS_CLARIFICATION → APPROVED → REJECTED → APPROVED
2. Post 3 comments in quick succession
3. Check API logs for errors

**Expected Results**:
- ✅ All status changes succeed
- ✅ All comments post successfully
- ✅ No database locking errors
- ✅ No detached instance errors

---

### 7. Frontend Error Boundary

**Objective**: Verify frontend handles errors gracefully

**Steps**:
1. Open document preview drawer
2. Open browser DevTools console
3. Interact with all UI elements
4. Check for any React errors or warnings

**Expected Results**:
- ✅ No "highlightMentions is not defined" errors
- ✅ No React component errors
- ✅ Error boundary doesn't trigger
- ✅ No CORS or authentication errors

---

### 8. Permissions & RBAC

**Objective**: Verify @mentions respect lane visibility and permissions

**Steps**:
1. As internal user, mention another internal user in INTERNAL lane comment
2. As external partner, try to mention internal user in EXTERNAL lane
3. Verify external partner cannot see internal-only comments

**Expected Results**:
- ✅ Internal mentions work in INTERNAL lane
- ✅ External partner cannot mention internal users in EXTERNAL lane (or mention is filtered)
- ✅ Visibility rules enforced

---

## Automated Test Runs

### Backend Unit Tests
```bash
cd /Users/dr.156/zen-ops/backend
pytest tests/test_mentions.py -v
```

**Expected**: All 13 tests pass

### Frontend Build Check
```bash
cd /Users/dr.156/zen-ops/frontend
npm run build
```

**Expected**: Build succeeds with no errors

---

## Log Verification Commands

### Check for Async Errors
```bash
docker logs zen-ops-api-1 --tail 200 | grep -E "(await|async|AsyncSession)"
```
Should return no matches in recent requests.

### Check for Detached Instance Errors
```bash
docker logs zen-ops-api-1 --tail 200 | grep -E "(detached|f405|not bound to)"
```
Should return no matches.

### Check Mention Processing
```bash
docker logs zen-ops-api-1 --tail 200 | grep -E "(mentioned_user_ids|Mentioned users)"
```
Should show successful mention resolution.

### Check Database Transactions
```bash
docker logs zen-ops-api-1 --tail 200 | grep -E "(COMMIT|ROLLBACK)"
```
Should show successful commits, no unexpected rollbacks.

---

## Success Criteria

### Critical (Must Pass)
- [ ] Document status changes save successfully
- [ ] Comments post without errors
- [ ] Review with notes works in single transaction
- [ ] No SQLAlchemy detached instance errors
- [ ] No async/await errors in logs

### Important (Should Pass)
- [ ] @Mentions are parsed and highlighted
- [ ] Mention notifications sent to target users
- [ ] Comment resolution toggle works
- [ ] Frontend has no console errors

### Nice to Have
- [ ] Rapid operations don't cause race conditions
- [ ] All 13 backend unit tests pass
- [ ] Frontend build succeeds

---

## Rollback Plan (If Tests Fail)

If critical issues are found:

1. **Immediate**: Revert to previous commit
   ```bash
   cd /Users/dr.156/zen-ops
   git checkout ai/work~3  # Before async/await removal
   docker compose build --no-cache api frontend
   docker compose up -d --no-deps api frontend
   ```

2. **Identify Root Cause**: Check logs for specific errors

3. **Targeted Fix**: Fix only the failing component

4. **Re-test**: Run affected test cases only

---

## Known Issues & Limitations

1. **Migration Error**: Unrelated payroll_policies table issue exists
   - **Workaround**: Use `--no-deps` flag when restarting containers
   - **Status**: Does not affect document preview functionality

2. **Mention Autocomplete**: Not yet implemented
   - **Impact**: Users must type full @email or @Name
   - **Priority**: Low - enhancement for future

3. **Email Notifications**: Mention emails not yet configured
   - **Impact**: In-app notifications work, emails pending Resend setup
   - **Priority**: Medium - part of next phase (Support + Email system)

---

## Next Steps After Testing

If all tests pass:
1. ✅ Update DEPLOYMENT_READY.md with test results
2. ✅ Push commits to remote: `git push origin ai/work`
3. ✅ Document any edge cases found
4. ⏸️ Plan next phase: Support + Email + WhatsApp system (SUPPORT_EMAIL_WHATSAPP_SPEC.md)

If tests fail:
1. ❌ Document specific failing scenarios
2. ❌ Check logs for root cause
3. ❌ Create targeted fixes
4. ❌ Re-run tests

---

## Test Results Log

**Date**: 2026-02-09
**Tester**: [Your Name]
**Environment**: Development (Docker)

### Test Results
```
[ ] 1. Document Review Workflow
[ ] 2. Comment Creation
[ ] 3. @Mentions in Comments
[ ] 4. Review with Notes
[ ] 5. Comment Resolution
[ ] 6. Stress Test
[ ] 7. Frontend Error Boundary
[ ] 8. Permissions & RBAC

Backend Tests: [ ] Pass [ ] Fail
Frontend Build: [ ] Pass [ ] Fail
```

### Issues Found
- None yet

### Notes
- 

---

*Generated: 2026-02-09*
*Last Updated: 2026-02-09*
