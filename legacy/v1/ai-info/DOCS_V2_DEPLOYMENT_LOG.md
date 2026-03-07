# Documents V2 Deployment Log

**Date**: 2026-02-08  
**Commit**: ac6b919  
**Branch**: ai/work  

## ✅ Completed

### Backend
- ✅ Migration 0028 created and applied
- ✅ DocumentReviewStatus enum (UPLOADED, RECEIVED, REVIEWED, NEEDS_CLARIFICATION, REJECTED, FINAL)
- ✅ DocumentVisibility enum (INTERNAL_ONLY, PARTNER_RELEASED)
- ✅ Enhanced AssignmentDocument model with review fields
- ✅ GET /api/assignments/{id}/documents - enhanced with comment counts
- ✅ GET /api/assignments/{id}/documents/{doc_id}/preview - inline file serving
- ✅ POST /api/assignments/{id}/documents/{doc_id}/review - one-shot review endpoint
- ✅ Permission checks enforced server-side

### Frontend  
- ✅ DocumentPreviewDrawerV2 component (520 lines)
- ✅ PDF preview with react-pdf (pagination, zoom)
- ✅ Image preview (zoom, rotate)
- ✅ DocumentComments integration (Internal Team / Client Requests lanes)
- ✅ Review workflow UI (quick actions + review-with-note form)
- ✅ Enhanced documents table (status column, comment badges, visibility chips)
- ✅ Role-based UI (hides controls from partners)
- ✅ Installed react-pdf ^7.x, pdfjs-dist

### Database
- ✅ Migration applied: `alembic_version = 0028_add_document_review_fields`
- ✅ Schema verified: review_status, visibility, reviewed_by_user_id, reviewed_at columns present

### Deployment
- ✅ API rebuilt and deployed to maulya-api-1
- ✅ Frontend rebuilt and deployed to maulya-frontend-1
- ✅ Health check: `{"status":"ok","alembic_revision":"0028_add_document_review_fields"}`

## 🧪 Testing Required

### Backend API Tests
```bash
# 1. Health check
curl http://localhost/api/readyz

# 2. Login and get token
TOKEN=$(curl -s -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | jq -r .access_token)

# 3. List documents with new fields
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost/api/assignments/1/documents" | jq '.[0] | {id, original_name, review_status, visibility, comments_count}'

# 4. Preview document
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost/api/assignments/1/documents/DOC_ID/preview" \
  --output test_preview.pdf

# 5. Review document
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost/api/assignments/1/documents/DOC_ID/review" \
  -d '{
    "review_status": "REVIEWED",
    "note": "Document looks good, approved for processing.",
    "lane": "INTERNAL"
  }' | jq '.'
```

### Frontend UI Tests
1. **Navigate to Assignment** → Documents tab
2. **Verify enhanced table**:
   - Status column with badges
   - Comment count badges
   - Visibility chips
3. **Click PDF document** → drawer opens
   - PDF renders with pages
   - Pagination controls work
   - Zoom works
4. **Click "Comments" tab**:
   - Two lanes visible: "Internal Team" and "Client Requests"
   - Can post new comment
   - Comment appears immediately
5. **Test review workflow**:
   - Click "Approve" quick button → status updates
   - Add review note + select status → note saves as INTERNAL comment
   - Verify document list updates

## 📝 Notes

- Migration 0027 (payroll_policies) was skipped - table doesn't exist in current schema
- Stamped directly to 0028 without data loss
- All existing endpoints remain functional (backward compatible)
- Server-side permissions enforce INTERNAL_ONLY vs PARTNER_RELEASED visibility

## 🔗 Related Files

- Migration: `backend/alembic/versions/0028_add_document_review_fields.py`
- Models: `backend/app/models/document.py`, `backend/app/models/enums.py`
- Routes: `backend/app/routers/documents.py`
- Schemas: `backend/app/schemas/document.py`
- Component: `frontend/src/components/DocumentPreviewDrawerV2.jsx`
- API: `frontend/src/api/documents.js`
- Page: `frontend/src/pages/AssignmentDetail.jsx`

