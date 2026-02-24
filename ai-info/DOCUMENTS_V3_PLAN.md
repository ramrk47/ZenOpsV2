# Documents V3 - Enhanced Preview + Templates

## ✅ Completed (Just Now)

### Enhanced Preview Capabilities
1. **Text File Support** - Now preview .txt, .md, .csv, .log, .json, .xml, .yaml files
2. **10MB File Size Limit** - Files > 10MB show "too large" message with size
3. **Better PDF Navigation:**
   - First/Last page buttons (⏮ ⏭)
   - Page number input (jump to specific page)
   - Prev/Next page buttons
   - Page counter (e.g., "5 / 24")

### File Types Now Supported:
- ✅ **PDF** - Full pagination, zoom, navigate
- ✅ **Images** - PNG, JPG, GIF, etc. with zoom/rotate
- ✅ **Text** - TXT, MD, CSV, LOG, JSON, XML, YAML
- ❌ **Large files** (>10MB) - Download only

## 🚧 Next: Document Templates Feature

### Use Case
Each bank/branch/service line needs their own standard document formats:
- Report templates
- Forms
- Assessment formats
- Bank-specific documentation

### Implementation Plan

#### 1. Backend: Document Templates Master Data

**New Table: `document_templates`**
```sql
CREATE TABLE document_templates (
  id UUID PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  category VARCHAR(100),  -- e.g., 'REPORT', 'FORM', 'ASSESSMENT'
  
  -- Scoping
  client_id UUID REFERENCES clients(id),  -- NULL = global, or specific to bank
  service_line VARCHAR(100),              -- NULL = all services, or specific
  property_type_id UUID REFERENCES property_types(id),  -- NULL = all types
  
  -- File info
  storage_path VARCHAR(500) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  size BIGINT,
  
  -- Metadata
  is_active BOOLEAN DEFAULT TRUE,
  display_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_user_id UUID REFERENCES users(id)
);

CREATE INDEX idx_document_templates_client ON document_templates(client_id);
CREATE INDEX idx_document_templates_service ON document_templates(service_line);
CREATE INDEX idx_document_templates_active ON document_templates(is_active);
```

#### 2. Backend API Endpoints

```python
# GET /api/master/document-templates
# - List all active templates
# - Filter by client_id, service_line, property_type_id
# - Admin/Ops can see all, Partners see only their client's templates

# POST /api/master/document-templates
# - Upload new template (Admin/Ops only)
# - Body: multipart/form-data with file + metadata

# GET /api/master/document-templates/{id}/download
# - Download template file

# PATCH /api/master/document-templates/{id}
# - Update template metadata
# - Admin/Ops only

# DELETE /api/master/document-templates/{id}
# - Soft delete (set is_active=false)
# - Admin/Ops only

# GET /api/assignments/{id}/available-templates
# - Get templates applicable to this assignment
# - Based on assignment's client, service_line, property_type
# - Returns list of templates that can be attached

# POST /api/assignments/{id}/documents/from-template/{template_id}
# - Create new assignment document from template
# - Copies template file to assignment
# - Creates assignment_documents entry
```

#### 3. Frontend: Master Data UI

**New Page: `/master-data/document-templates`**

Features:
- List view with filters (Client, Service Line, Category)
- Upload new template button
- Edit/Delete template
- Preview template before download
- Bulk upload support

**Upload Form:**
```
Name: [_______________]
Description: [_______________]
Category: [Dropdown: Report/Form/Assessment/Other]

Scope (Optional - leave blank for global):
  Client: [Dropdown: All Banks / Specific Bank]
  Service Line: [Dropdown: All / Valuation / Audit / ...]
  Property Type: [Dropdown: All / Residential / Commercial / ...]

File: [Choose File] (Max 10MB)

[Save Template]
```

#### 4. Frontend: Assignment Detail Integration

**In Documents Tab - Add "Add from Template" Button:**

```jsx
<button onClick={() => setTemplatesDrawerOpen(true)}>
  📋 Add from Template
</button>
```

**Templates Drawer:**
- Shows templates filtered by assignment's client/service/property
- Grid/list view with template preview
- Click template → Confirm → Adds to assignment documents
- Shows: Name, Category, Size, Preview icon

#### 5. Migration Script

```python
# backend/alembic/versions/0029_add_document_templates.py
def upgrade():
    # Create document_templates table
    # Create indexes
    # Seed with sample templates?
    pass
```

## Testing Checklist

### Enhanced Preview (V2.5)
- [ ] Open text file → Preview shows content
- [ ] Open PDF → Can navigate pages with First/Last buttons
- [ ] Open PDF → Can jump to specific page via input
- [ ] Try file >10MB → Shows "too large" message
- [ ] Open image → Zoom/rotate works

### Document Templates (V3)
- [ ] Admin can upload template
- [ ] Template scoped to client appears only for that client's assignments
- [ ] Click "Add from Template" in assignment → Shows applicable templates
- [ ] Select template → Creates new document in assignment
- [ ] Partner cannot upload/edit templates (read-only)

## Timeline

- ✅ **Phase 1** (Done): Enhanced preview + file size check
- **Phase 2** (Next): Backend - Templates table + API (2-3 hours)
- **Phase 3**: Frontend - Master data UI (2 hours)
- **Phase 4**: Frontend - Assignment integration (1 hour)
- **Phase 5**: Testing + polish (1 hour)

**Total Estimate:** ~6-7 hours for full V3 implementation

## Notes

- Templates are **copies** - modifying template doesn't affect existing docs
- Each bank can have unlimited templates
- Global templates (client_id=NULL) available to all assignments
- Templates inherit assignment's visibility rules
- Consider adding template versioning later (V3.1)?

---
**Status:** Preview improvements deployed. Ready for templates backend next.
