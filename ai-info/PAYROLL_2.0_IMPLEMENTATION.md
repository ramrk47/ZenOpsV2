# Payroll 2.0 + Document Preview Implementation Plan

## Current Status ✅

### Backend (100% Complete)
- ✅ Database models created (SalaryStructure, PayrollRun, PayrollLineItem, Payslip, PayrollPolicy)
- ✅ Migrations created (0024, 0025) with hybrid payroll model
- ✅ API endpoints implemented (`/api/payroll/*`)
- ✅ Payroll calculation service with attendance integration
- ✅ State machine workflow (7 states: Draft → Locked)
- ✅ Statutory calculations (PF, ESI, PT, TDS) as configurable
- ✅ Committed to ai/work branch (commit: a88f122)

### Frontend (In Progress)
- ✅ API client created (`frontend/src/api/payroll.js`)
- ✅ Payroll Runs List page created (`frontend/src/pages/admin/PayrollRuns.jsx`)
- ⏳ Payroll Run Detail page (needs creation)
- ⏳ Employee Directory page (needs creation)
- ⏳ Reports/Exports page (needs creation)
- ⏳ Sidebar navigation update (needs update)
- ⏳ Document preview system (needs creation)
- ⏳ Comments system (needs creation)

## Next Steps

### 1. Payroll Run Detail Page (HIGH PRIORITY)
**File:** `frontend/src/pages/admin/PayrollRunDetail.jsx`

**Requirements:**
- Header with run title, status stepper, action buttons
- 7 tabs:
  1. **Overview** - KPIs, exceptions panel, funding note
  2. **Line Items** - Employee payroll table with drawer for details
  3. **Payslips** - Payslip management with preview
  4. **Attendance Summary** - Attendance contribution data
  5. **Approvals** - Approval chain tracking (future)
  6. **Audit Log** - All lifecycle events
  7. **Exports** - Bank transfer CSV, payroll register, statutory

**Key Features:**
- Status-based action buttons (Calculate, Approve, Mark Paid, Close)
- Exception detection and resolution workflow
- Employee payroll line drawer with:
  - Salary breakdown
  - Attendance breakdown
  - Deductions detail
  - Manual adjustments (admin only)
  - Internal notes
- Payslip preview drawer
- Export downloads

### 2. Employee Directory Page
**File:** `frontend/src/pages/admin/PayrollEmployees.jsx`

**Requirements:**
- Searchable table of all employees with salary structures
- Columns: Employee, Role, Salary Model, Monthly Base, Status, Effective Date
- Row click opens salary structure editor drawer
- "Add Salary Structure" button
- Salary history view per employee
- Effective-dated versioning support

### 3. Reports/Exports Center
**File:** `frontend/src/pages/admin/PayrollReports.jsx`

**Requirements:**
- Export buttons for:
  - Payroll Run Summary CSV
  - Net Pay List (for bank transfer)
  - Statutory Summary (PF/ESI/PT/TDS)
  - Payslip Archive (future)
- Month range selector
- Download history table
- Export status tracking

### 4. Sidebar Navigation Update
**File:** `frontend/src/components/sidebars/AdminSidebar.jsx`

**Add to Finance section:**
```javascript
const financeLinks = [
  { to: '/admin/payroll', label: 'Payroll Runs', enabled: canViewPayroll },
  { to: '/admin/payroll/employees', label: 'Salary Structures', enabled: canViewPayroll },
  { to: '/admin/payroll/reports', label: 'Payroll Reports', enabled: canViewPayroll },
  { to: '/invoices', label: 'Invoices', enabled: hasCapability(capabilities, 'view_invoices') },
  // ... existing items
]
```

### 5. Document Preview System (Assignment Detail)
**File:** `frontend/src/components/DocumentPreviewDrawer.jsx`

**Requirements:**
- PDF preview using `react-pdf` or `@react-pdf-viewer`
- Image preview with zoom/rotate controls
- Left panel: file preview
- Right panel: metadata + actions + comments
- Actions: Download, Mark Final, Copy Link, Add Comment
- Support keyboard shortcuts (ESC to close, arrow keys to navigate)

### 6. Comments System
**Files:**
- `frontend/src/components/DocumentComments.jsx`
- `backend/app/models/document_comment.py`
- `backend/app/routers/document_comments.py`

**Two comment lanes:**
1. **Internal Comments** (default)
   - Visible only to internal staff
   - @mentions support with dropdown
   - Timestamped with author
   - Edit/delete for own comments

2. **External Requests** (separate)
   - Admin creates request for external partner
   - Partner sees only their requests + responses
   - Status: Open / Responded / Accepted / Closed
   - File attachment support

**Backend Schema:**
```python
class DocumentComment(Base):
    document_id, user_id, comment_text
    comment_type: INTERNAL | EXTERNAL_REQUEST
    parent_id (for threading)
    mentions (JSONB)
    created_at, updated_at, deleted_at
```

### 7. UI Quality Fixes

**Responsive Grid Fixes:**
- Update `styles.css` with better grid breakpoints
- Add `min-width` constraints to prevent overlap
- Test at 1920px, 1440px, 1280px, 1024px

**Help Icons:**
- Add `<span className="info-icon" title="...">ⓘ</span>` to all KPI tiles
- Create `.info-icon` CSS class with hover tooltip

**Loading States:**
- Add skeleton loaders for tables
- Spinner for async actions
- Optimistic UI updates where appropriate

**Empty States:**
- Consistent messaging across all pages
- Helpful CTA buttons in empty states

## Implementation Order (Recommended)

1. **Phase 1 - Core Payroll UI** (2-3 hours)
   - Payroll Run Detail page
   - Update sidebar navigation
   - Test full payroll workflow

2. **Phase 2 - Employee Management** (1 hour)
   - Employee Directory page
   - Salary structure editor

3. **Phase 3 - Reports** (30 mins)
   - Reports/Exports page
   - CSV generation endpoints

4. **Phase 4 - Document Preview** (2 hours)
   - Document preview drawer
   - PDF/image viewers
   - Integration with Assignment Detail

5. **Phase 5 - Comments** (2 hours)
   - Comment backend models
   - Comment UI components
   - Internal/External lanes
   - @mentions functionality

6. **Phase 6 - Polish** (1 hour)
   - Responsive fixes
   - Help icons
   - Loading/empty states
   - Cross-browser testing

## API Endpoints Already Available

### Payroll Runs
- `GET /api/payroll/runs` - List runs with filters
- `GET /api/payroll/runs/:id/detail` - Full run details
- `POST /api/payroll/runs` - Create run
- `POST /api/payroll/runs/:id/calculate` - Calculate payroll
- `POST /api/payroll/runs/:id/send-approval` - Send for approval
- `POST /api/payroll/runs/:id/approve` - Approve run
- `POST /api/payroll/runs/:id/mark-paid` - Mark as paid
- `POST /api/payroll/runs/:id/close` - Close and lock run
- `GET /api/payroll/runs/:id/export/:type` - Export data

### Salary Structures
- `GET /api/payroll/salary-structures` - List structures
- `GET /api/payroll/salary-structures/:id` - Get structure
- `POST /api/payroll/salary-structures` - Create structure
- `PATCH /api/payroll/salary-structures/:id` - Update structure

### Payslips
- `GET /api/payroll/payslips` - List payslips
- `GET /api/payroll/payslips/my` - Employee's own payslips
- `GET /api/payroll/payslips/:id/download` - Download PDF
- `POST /api/payroll/payslips/:id/generate` - Generate PDF
- `POST /api/payroll/payslips/:id/send-email` - Email payslip

### Stats
- `GET /api/payroll/stats` - Payroll KPIs and stats

## Testing Checklist

### Payroll Workflow
- [ ] Create payroll run for current month
- [ ] Calculate payroll (with and without attendance data)
- [ ] Review exceptions panel
- [ ] Preview employee line items
- [ ] Make manual adjustment
- [ ] Generate payslips
- [ ] Preview payslip in UI
- [ ] Export bank transfer CSV
- [ ] Approve payroll run
- [ ] Mark as paid
- [ ] Close and lock run
- [ ] Verify audit log entries

### Document Preview
- [ ] Upload PDF to assignment
- [ ] Click to open preview drawer
- [ ] Verify PDF renders correctly
- [ ] Test zoom controls
- [ ] Upload image
- [ ] Verify image preview with rotate
- [ ] Test keyboard shortcuts (ESC, arrows)

### Comments
- [ ] Add internal comment on document
- [ ] @mention another user
- [ ] Verify mention notification
- [ ] Create external request
- [ ] Verify external user sees only their requests
- [ ] Respond to request as external user
- [ ] Mark request as closed

### Responsive Design
- [ ] Test at 1920x1080 (no overlaps)
- [ ] Test at 1440x900 (cards wrap properly)
- [ ] Test at 1280x720 (minimum supported)
- [ ] Test Chrome, Firefox, Safari
- [ ] Verify mobile message shows on <1024px

## Known Limitations & Future Enhancements

### Current Limitations
- PDF generation is stubbed (payslip content exists but PDF creation needs template)
- Overtime approval workflow exists in model but no UI yet
- Statutory calculations use fixed rates (no slabs yet)
- Multi-approver workflow modeled but not enforced
- External partner document visibility not yet implemented

### Future Enhancements
- PDF watermarking for payslips
- Bulk payslip email with retry logic
- Attendance exceptions auto-resolution
- TDS auto-calculation with IT declaration support
- Form 16 generation (end of FY)
- Payroll comparison reports (YoY, MoM)
- Department-wise payroll splits
- Custom salary component templates

## Deployment Notes

### Database Migration
```bash
cd backend
alembic upgrade head  # Runs 0024 and 0025 migrations
```

### Seed Data
```bash
# Create sample payroll policy
python -m app.seed_payroll

# Create sample salary structures for existing users
python -m app.seed_salary_structures
```

### Environment Variables
No new environment variables needed. Payroll uses existing auth and DB config.

### Docker Rebuild
```bash
docker compose build api frontend
docker compose up -d
```

## Documentation Updates

- [ ] Update PROJECT_MAP.md with payroll architecture
- [ ] Add payroll workflow to docs/
- [ ] Update RBAC matrix with payroll capabilities
- [ ] Document statutory calculation formulas
- [ ] Add payroll troubleshooting guide

## Commit Strategy

1. Commit Phase 1 (Core Payroll UI): `feat(payroll): add comprehensive payroll UI`
2. Commit Phase 2-3 (Employees + Reports): `feat(payroll): add employee management and reports`
3. Commit Phase 4-5 (Documents): `feat(documents): add preview and comments system`
4. Commit Phase 6 (Polish): `fix(ui): improve responsive design and UX`

---

**Total Estimated Time:** 8-10 hours for complete implementation
**Priority:** High (requested by user for production use)
**Dependencies:** None (backend complete, frontend incremental)
