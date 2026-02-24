# Frontend Not Updated - Rebuild Required

## Problem
The frontend container was serving an **old build** from 06:22 that doesn't include Documents V2 preview drawer.

## Solution
```bash
cd /Users/dr.156/zen-ops

# Rebuild frontend with new code
docker compose build frontend

# Restart frontend
docker compose up -d frontend

# Clear browser cache (important!)
# Chrome/Firefox: Ctrl+Shift+R or Cmd+Shift+R
# Safari: Cmd+Option+E
```

## What to Test After Rebuild

1. **Hard refresh** your browser (Ctrl+Shift+R)
2. Login: admin@zenops.local / password
3. Go to any Assignment
4. Click **Documents** tab
5. You should now see:
   - Enhanced document table with **Status** column
   - **Comment count badges**
   - Clicking a document opens **preview drawer** (right side)
   - Preview drawer shows:
     - PDF viewer (if PDF) or Image viewer
     - Review status dropdown
     - "Add review note" textarea
     - "Save Note" and "Save + Mark Reviewed" buttons
     - DocumentComments component (Internal Team / Client Requests tabs)

## Verification Checklist

- [ ] Document table has Status column
- [ ] Document table shows comment counts
- [ ] Clicking document opens drawer (not just download)
- [ ] PDF preview works (with pagination)
- [ ] Image preview works (with zoom)
- [ ] Review workflow UI visible
- [ ] Can add internal notes
- [ ] Can change document status

## If Still Not Working

Check browser console (F12) for errors:
- React-pdf loading issues?
- API endpoints returning 404?
- CORS errors?

Check network tab:
- Is `/api/assignments/{id}/documents/{doc_id}/preview` endpoint being called?
- Are DocumentComments loading?

## Backend Endpoints to Verify

```bash
TOKEN=$(curl -s -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@zenops.local&password=password" | jq -r .access_token)

# List documents with comment counts
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost/api/assignments/1/documents | jq

# Preview a document (should return file content)
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost/api/assignments/1/documents/1/preview \
  --output test.pdf

# List comments for a document
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost/api/document-comments?document_id=1 | jq
```

---
**Status:** Frontend rebuild in progress...
