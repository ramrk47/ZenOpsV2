# Zen Ops Payroll System Setup & Configuration

## Overview
Zen Ops implements a hybrid payroll system tailored for Indian small businesses with:
- **Monthly salary model**: Fixed monthly salary ÷ 30 days (configurable divisor)
- **Attendance tracking**: Work sessions tracked, converts to paid/unpaid days
- **Statutory compliance**: PF, ESI, PT, TDS automated calculations
- **OT management**: Approved overtime as additional payable days
- **Policy flexibility**: Company-wide policies + per-employee overrides

---

## Database Models

### 1. **SalaryStructure** (`salary_structures` table)
Each employee's compensation package.

```json
{
  "user_id": 3,
  "effective_from": "2026-01-01",
  "monthly_ctc": 60000,
  "monthly_gross": 50000,
  "payroll_divisor_days": 30,
  "standard_minutes_per_day": 480,
  "overtime_multiplier": 2.0,
  "overtime_requires_approval": true,
  "pf_enabled": true,
  "esi_enabled": false,
  "pt_enabled": true,
  "tds_mode": "MANUAL"
}
```

**Divisor Days**: How many days to divide monthly salary. Default 30 (Indian practice).

### 2. **PayrollPolicy** (`payroll_policies` table)
Company-wide policy defaults.

```json
{
  "monthly_pay_days": 30,
  "full_day_minimum_minutes": 480,
  "lop_on_absent": true,
  "overtime_enabled": false,
  "overtime_multiplier": 1.5,
  "overtime_requires_approval": true,
  
  "pf_enabled_default": true,
  "pf_employee_rate": 12.0,
  "pf_employer_rate": 12.0,
  "pf_wage_ceiling": 15000.0,
  
  "esi_enabled_default": false,
  "esi_employee_rate": 0.75,
  "esi_employer_rate": 3.25,
  
  "pt_enabled_default": true,
  "pt_monthly_amount": 200.0,
  
  "weekly_off_day": 6,
  "annual_paid_leave_quota": 21,
  "company_holidays": [
    {"date": "2026-01-26", "name": "Republic Day", "paid": true},
    {"date": "2026-03-08", "name": "Maha Shivaratri", "paid": true},
    {"date": "2026-03-29", "name": "Holi", "paid": true}
  ]
}
```

### 3. **WorkSession** (`work_sessions` table)
Employee login/logout tracking.

```json
{
  "user_id": 3,
  "login_at": "2026-02-01T08:00:00Z",
  "logout_at": "2026-02-01T17:00:00Z",
  "duration_minutes": 540,
  "session_type": "AUTO"
}
```

### 4. **PayrollRun** (`payroll_runs` table)
Monthly payroll period container.

Status flow: `DRAFT` → `CALCULATED` → `APPROVED` → `PAID` → `LOCKED`

```json
{
  "month": "2026-02",
  "year": 2026,
  "status": "CALCULATED",
  "employee_count": 2,
  "total_gross": 85000.0,
  "total_net": 75000.0
}
```

### 5. **PayrollLineItem** (`payroll_line_items` table)
Per-employee payroll calculation for a month.

```json
{
  "payroll_run_id": 1,
  "user_id": 3,
  "days_payable": 22.0,
  "days_lop": 8.0,
  "base_pay": 36667.0,
  "overtime_pay": 1500.0,
  "gross_pay": 38167.0,
  "pf_employee": 3667.0,
  "pf_employer": 3667.0,
  "pt": 200.0,
  "tds": 2000.0,
  "net_pay": 31300.0
}
```

---

## Payroll Calculation Formula

```
daily_rate = monthly_gross / payroll_divisor_days

base_pay = daily_rate × days_payable

overtime_rate = (daily_rate / standard_hours_per_day) × overtime_multiplier
overtime_pay = (overtime_minutes / 60) × overtime_rate  [if approved]

gross_pay = base_pay + overtime_pay

deductions = PF (employee) + ESI (employee) + PT + TDS
net_pay = gross_pay - deductions
```

### Example Calculation
```
Monthly Gross:  ₹50,000
Divisor Days:   30
Daily Rate:     ₹1,667 (50,000 / 30)

Days Present:   22
Days LOP:       8

Base Pay = ₹1,667 × 22 = ₹36,667

OT Hours: 10 hours (if approved)
Overtime Multiplier: 2.0
Hourly Rate: ₹208 (1,667 / 8 hours)
Overtime Rate: ₹416 (208 × 2.0)
Overtime Pay: 10 × ₹416 = ₹4,160

Gross Pay = ₹36,667 + ₹4,160 = ₹40,827

PF (Employee 12%): ₹4,899
PT (Fixed): ₹200
Net Pay = ₹40,827 - ₹4,899 - ₹200 = ₹35,728
```

---

## API Endpoints

### Salary Structures
```bash
# Create salary structure for employee
POST /api/payroll/salary-structures
{
  "user_id": 3,
  "effective_from": "2026-01-01",
  "monthly_ctc": 60000,
  "monthly_gross": 50000
}

# List salary structures (active only)
GET /api/payroll/salary-structures?active_only=true

# Get employee's active salary structure
GET /api/payroll/salary-structures/{user_id}/active
```

### Payroll Policy
```bash
# Get company policy (auto-creates default if none exists)
GET /api/payroll/policy

# Update policy
PATCH /api/payroll/policy
{
  "weekly_off_day": 6,
  "annual_paid_leave_quota": 25,
  "company_holidays": [...]
}
```

### Payroll Runs
```bash
# Create new payroll run
POST /api/payroll/runs
{
  "month": "2026-02",
  "year": 2026
}

# List payroll runs
GET /api/payroll/runs?limit=50&offset=0

# Get payroll run details
GET /api/payroll/runs/{id}/detail

# Calculate payroll (generate line items)
POST /api/payroll/runs/{id}/calculate

# Approve payroll
POST /api/payroll/runs/{id}/approve

# Mark as paid
POST /api/payroll/runs/{id}/mark-paid

# Close & lock (final)
POST /api/payroll/runs/{id}/lock

# Get payroll stats
GET /api/payroll/stats
```

---

## End-to-End Workflow

### 1. **Setup Phase** (First Time)
```bash
# Admin creates default payroll policy
PATCH /api/payroll/policy
{
  "weekly_off_day": 6,
  "annual_paid_leave_quota": 21,
  "company_holidays": [
    {"date": "2026-01-26", "name": "Republic Day", "paid": true}
  ]
}

# HR creates salary structures for employees
POST /api/payroll/salary-structures
{
  "user_id": 3,
  "effective_from": "2026-01-01",
  "monthly_gross": 50000
}
```

### 2. **Monthly Payroll Cycle** (Repeating)
```
a) Attendance Collection
   - Employees use "heartbeat" endpoint to log work sessions
   - System auto-calculates presence based on work sessions

b) Payroll Run Creation
   POST /api/payroll/runs {"month": "2026-02", "year": 2026}
   Status: DRAFT

c) Calculate Payroll
   POST /api/payroll/runs/{id}/calculate
   - Backend fetches work sessions for the month
   - Calculates days_payable, days_lop from work duration
   - Generates PayrollLineItems with salary breakdown
   - Flags exceptions (e.g., incomplete attendance)
   Status: CALCULATED

d) Review & Approve
   - Finance reviews line items, attendance
   - Can override LOP, edit deductions, approve OT
   POST /api/payroll/runs/{id}/approve
   Status: APPROVED

e) Payment & Lock
   POST /api/payroll/runs/{id}/mark-paid
   Status: PAID
   
   POST /api/payroll/runs/{id}/lock
   Status: LOCKED (immutable, audit trail complete)

f) Export (for bank transfer, compliance, etc.)
   GET /api/payroll/runs/{id}/export/bank-transfer
   GET /api/payroll/runs/{id}/export/payroll-register
```

---

## Accessing the Web UI

### Admin Panel
- **URL**: http://localhost/admin/payroll
- **Roles**: Finance, Admin
- **Actions**:
  - Create new payroll run (month/year picker)
  - Calculate payroll from run detail
  - Review line items (employee breakdown)
  - Review attendance summary (days present, LOP, OT)
  - Approve or reject payroll
  - Mark paid & lock
  - Export to CSV

### Employee Portal (Future)
- View personal payslips
- Request leave (for approval)
- View salary structure
- Download payslips as PDF

---

## Common Issues & Fixes

### Issue: Payroll calculation returns 0 employees
**Cause**: No active salary structures for the period
**Fix**: Create salary structure for all employees via POST /api/payroll/salary-structures

### Issue: All employees show LOP = 30 days
**Cause**: No work sessions recorded for the month
**Fix**: Employees must use /api/attendance/heartbeat endpoint to log work

### Issue: OT pay not calculated
**Cause**: OT not approved, or overtime_requires_approval = true but overtime_approved = false
**Fix**: 
1. Check SalaryStructure.overtime_requires_approval
2. In PayrollLineItem, set overtime_approved = true or disable approval requirement

### Issue: Statutory deductions (PF/ESI) seem wrong
**Cause**: Wage ceiling limits or employee/employer rate mismatch
**Fix**: 
1. Verify SalaryStructure.pf_enabled, esi_enabled, pt_enabled
2. Check PayrollPolicy default rates
3. Review calculation: `pf = min(monthly_gross, wage_ceiling) × pf_employee_rate / 100`

---

## Testing Locally

### Seed Test Data
(Run these as SQL queries or via a seed script)

```sql
-- Create test payroll policy
INSERT INTO payroll_policies (
  policy_name, is_active, monthly_pay_days,
  full_day_minimum_minutes, grace_period_minutes,
  lop_on_absent, overtime_enabled,
  pf_enabled_default, pf_employee_rate, pf_employer_rate,
  esi_enabled_default, pt_enabled_default,
  weekly_off_day, annual_paid_leave_quota
) VALUES (
  'Default Company Policy', true, 30,
  480, 15,
  true, false,
  true, 12.0, 12.0,
  false, true,
  6, 21
);

-- Create salary structures for test employees
INSERT INTO salary_structures (user_id, effective_from, monthly_ctc, monthly_gross, payroll_divisor_days)
VALUES
  (3, '2026-01-01', 60000, 50000, 30),
  (4, '2026-01-01', 45000, 35000, 30);

-- Create work sessions for February 2026
-- (Employee 3: ₹50k/month, working 22 days)
INSERT INTO work_sessions (user_id, login_at, last_seen_at, logout_at, duration_minutes, session_type)
SELECT 3, 
  to_timestamp(extract(epoch from date '2026-02-01' + (n || ' days')::interval + '08:00'::time)),
  to_timestamp(extract(epoch from date '2026-02-01' + (n || ' days')::interval + '17:00'::time)),
  to_timestamp(extract(epoch from date '2026-02-01' + (n || ' days')::interval + '17:00'::time)),
  540,  -- 9 hours
  'AUTO'
FROM generate_series(1, 22) n
WHERE to_date(date '2026-02-01' + (n || ' days')::interval) NOT IN (
  SELECT to_date(date '2026-02-05' + (7 || ' days')::interval * (series / 7))  -- Sundays
);
```

Then:
1. Create payroll run: POST /api/payroll/runs {"month": "2026-02", "year": 2026}
2. Calculate: POST /api/payroll/runs/{id}/calculate
3. Review via http://localhost/admin/payroll/{id}

---

## Database Connection String
Default (Docker): `postgresql://postgres:postgres@db:5432/zen_ops`

---

## Future Enhancements
- [ ] Per-date attendance state (PRESENT, ABSENT, PAID_LEAVE, UNPAID_LEAVE, WEEKLY_OFF, OT_APPROVED)
- [ ] Payslip PDF generation
- [ ] Leave approval workflow integrated with LOP
- [ ] Advance salary / loan deductions
- [ ] Tax bracket calculation (progressive TDS)
- [ ] Multi-company payroll consolidation
- [ ] Compliance reports (e-filing templates)
