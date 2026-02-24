# Documents V3 - Implementation Status

## ✅ Phase 1: Enhanced Preview (COMPLETE)

**Deployed:** Feb 8, 2026 13:06

### Features Implemented:
- **Text File Preview:** .txt, .md, .csv, .log, .json, .xml, .yaml files now preview in-app
- **10MB File Size Limit:** Files larger than 10MB show clear "too large" message
- **Enhanced PDF Navigation:**
  - First page button (⏮)
  - Previous page button (← Prev)
  - Page number input field (jump to specific page)
  - Next page button (Next →)
  - Last page button (⏭)
  - Page counter (e.g., "5 / 24")
- **Image Preview:** Existing zoom/rotate functionality preserved

### Testing:
- Text files load and display properly in monospace font
- PDF pagination controls work smoothly
- File size check prevents preview of large files
- Images still zoom and rotate correctly

---

## 🚧 Phase 2: Document Templates Backend (IN PROGRESS)

**Status:** Database ready, API endpoints next

### Completed:
✅ **DocumentTemplate model** created:
   - UUID primary key
   - name, description, category fields
   - Scoping: client_id, service_line, property_type_id (nullable)
   - File info: storage_path, original_name, mime_type, size
   - Metadata: is_active, display_order, created_by_user_id
   - Timestamps: created_at, updated_at

✅ **Database migration 0029** applied:
   - document_templates table created
   - Indexes on client_id, service_line, property_type_id, is_active
   - Foreign keys to clients, property_types, users

✅ **Relationships added:**
   - Client.document_templates
   - PropertyType.document_templates
   - DocumentTemplate.client, .property_type, .created_by

### Next Steps:
1. Create document template schemas (Pydantic)
2. Create API endpoints (see below)
3. Test CRUD operations

---

## 📋 Phase 3: API Endpoints (TODO)

### Required Endpoints:

```python
# Master Data - Document Templates
GET    /api/master/document-templates
       Query params: client_id, service_line, property_type_id, is_active
       Returns: List of templates with file info
       
POST   /api/master/document-templates
       Body: multipart/form-data (file + metadata)
       Returns: Created template
       
GET    /api/master/document-templates/{id}
       Returns: Template details
       
GET    /api/master/document-templates/{id}/download
       Returns: FileResponse with template file
       
PATCH  /api/master/document-templates/{id}
       Body: metadata updates (name, description, scope, display_order)
       Returns: Updated template
       
DELETE /api/master/document-templates/{id}
       Soft delete: sets is_active=false
       Returns: 204 No Content

# Assignment Integration
GET    /api/assignments/{id}/available-templates
       Returns: Templates applicable to assignment
       Based on: assignment.client_id, assignment.service_line, assignment.property_type_id
       Logic: (template.client_id IS NULL OR = assignment.client_id) AND ...
       
POST   /api/assignments/{id}/documents/from-template/{template_id}
       Body: optional metadata overrides
       Action: Copy template file to assignment uploads
       Creates: New assignment_documents entry
       Returns: Created document
```

### Permissions:
- **Admin/Ops:** Full CRUD on templates
- **EXTERNAL_PARTNER:** Read-only, filtered to their client's templates only

---

## 🎨 Phase 4: Frontend UI (TODO)

### Master Data Page

**Route:** `/master-data/document-templates`

**Features:**
- List view with data grid
- Filter chips: Client, Service Line, Category, Active/Inactive
- Upload new template button
- Edit/Delete actions per row
- Preview template before download
- Bulk upload support (nice-to-have)

**Upload Form:**
```
┌─────────────────────────────────────────┐
│ Upload Document Template                │
├─────────────────────────────────────────┤
│ Name: [_____________________________]   │
│ Description: [______________________]   │
│ Category: [Dropdown: Report/Form/...]   │
│                                         │
│ Scope (Optional - leave blank for all): │
│   Client: [Dropdown: All / Bank 1 / ...]│
│   Service: [Dropdown: All / Valuation...]│
│   Property: [Dropdown: All / Resident...]│
│                                         │
│ File: [Choose File] (Max 10MB)          │
│                                         │
│ [ Cancel ] [ Upload Template ]          │
└─────────────────────────────────────────┘
```

### Assignment Detail Integration

**Location:** Documents tab, above document list

**UI Addition:**
```jsx
<div className="templates-section card">
  <h3>📋 Available Templates</h3>
  <div className="template-chips">
    {templates.map(t => (
      <button className="template-chip" onClick={() => addFromTemplate(t.id)}>
        {t.name} ({formatFileSize(t.size)})
      </button>
    ))}
  </div>
  {templates.length === 0 && (
    <div className="muted">No templates available for this assignment</div>
  )}
</div>
```

**Flow:**
1. Click template chip
2. Confirm modal: "Add [template name] to documents?"
3. POST /api/assignments/{id}/documents/from-template/{template_id}
4. Template copied, new document appears in list
5. Toast notification: "Template added successfully"

---

## 📊 Testing Checklist

### Enhanced Preview (Phase 1)
- [x] Open .txt file → Preview shows content
- [x] Open .pdf → Navigate with First/Prev/Next/Last
- [x] Open .pdf → Jump to page 10 via input
- [x] Open file >10MB → Shows "too large" message
- [x] Open image → Zoom/rotate still works

### Document Templates (Phase 2-4)
- [ ] Admin uploads template (global scope)
- [ ] Admin uploads template (Bank 1 only)
- [ ] Template appears in master data list
- [ ] Filter templates by client
- [ ] Download template from master data
- [ ] Edit template metadata
- [ ] Soft delete template (is_active=false)
- [ ] Open assignment for Bank 1 → See Bank 1 templates
- [ ] Open assignment for Bank 2 → Don't see Bank 1 templates
- [ ] Click "Add from Template" → Document created
- [ ] External partner sees only their templates
- [ ] External partner cannot upload/edit templates

---

## 🚀 Deployment Notes

**Last Deployment:**
- Date: Feb 8, 2026 13:06
- Bundle: index-3dd09a52.js (1.23MB)
- Backend: Migration 0029 manually applied
- Status: ✅ Enhanced preview working

**Migration Issues:**
- Migration 0027 (payroll_policies) fails - table doesn't exist
- Migrations 0027/0028 skipped, went 0026 → 0029 directly
- Document review fields (0028) manually applied earlier
- Alembic version: 0029_add_document_templates

**Known Limitations:**
- Payroll migrations (0027/0028) not in sync with database
- Need to clean up migration chain later
- For now: templates work, documents V2 works, preview works

---

## 📈 Timeline Estimate

- ✅ **Phase 1** (Preview enhancements): 2 hours → DONE
- ✅ **Phase 2a** (Templates model + DB): 1 hour → DONE
- ⏳ **Phase 2b** (Templates API): 2 hours → TODO
- ⏳ **Phase 3** (Master data UI): 2 hours → TODO
- ⏳ **Phase 4** (Assignment integration): 1 hour → TODO
- ⏳ **Phase 5** (Testing + polish): 1 hour → TODO

**Total:** 9 hours (3 done, 6 remaining)

---

## 💡 Future Enhancements (V3.1+)

- Template versioning (v1, v2, etc.)
- Template usage tracking (how many times used)
- Template variables (e.g., {{client_name}}, {{date}})
- Template preview in master data (before download)
- Template categories as enum
- Bulk template upload (ZIP file with metadata CSV)
- Template approval workflow
- Template audit log

---

**Current Focus:** Implementing Phase 2b (API endpoints) next.
