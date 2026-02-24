import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  fetchPayrollRunDetail,
  calculatePayrollRun,
  approvePayrollRun,
  markPayrollRunPaid,
  closePayrollRun,
  exportPayrollRun,
} from '../../api/payroll'

const STATUS_STEPS = [
  { key: 'DRAFT', label: 'Draft' },
  { key: 'CALCULATED', label: 'Calculated' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'PAID', label: 'Paid' },
  { key: 'LOCKED', label: 'Closed' },
]

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'line-items', label: 'Line Items' },
  { id: 'payslips', label: 'Payslips' },
  { id: 'attendance', label: 'Attendance Summary' },
  { id: 'audit', label: 'Audit Log' },
  { id: 'exports', label: 'Exports' },
]

export default function PayrollRunDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [run, setRun] = useState(null)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [actionLoading, setActionLoading] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState(null)

  useEffect(() => {
    loadRunDetail()
  }, [id])

  async function loadRunDetail() {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchPayrollRunDetail(id)
      setRun(data)
    } catch (err) {
      console.error('Failed to load payroll run:', err)
      setError(err.message || 'Failed to load payroll run')
    } finally {
      setLoading(false)
    }
  }

  async function handleAction(actionFn, actionName) {
    if (!confirm(`Are you sure you want to ${actionName}?`)) return

    setActionLoading(true)
    try {
      await actionFn(id)
      await loadRunDetail()
      alert(`${actionName} successful!`)
    } catch (err) {
      console.error(`Failed to ${actionName}:`, err)
      alert(err.response?.data?.detail || `Failed to ${actionName}`)
    } finally {
      setActionLoading(false)
    }
  }

  async function handleExport(exportType) {
    try {
      const blob = await exportPayrollRun(id, exportType)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `payroll_${run.month}_${exportType}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      console.error('Export failed:', err)
      alert('Export failed')
    }
  }

  function formatCurrency(amount) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount || 0)
  }

  function formatDate(dateStr) {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  if (loading) {
    return (
      <div className="page">
        <div className="empty">Loading payroll run...</div>
      </div>
    )
  }

  if (error || !run) {
    return (
      <div className="page">
        <div className="empty">
          <div style={{ marginBottom: 8 }}>Error: {error || 'Payroll run not found'}</div>
          <button onClick={() => navigate('/admin/payroll')}>
            Back to Payroll Runs
          </button>
        </div>
      </div>
    )
  }

  const currentStepIndex = STATUS_STEPS.findIndex(s => s.key === run.status)
  const canCalculate = run.status === 'DRAFT' || run.status === 'TIME_PENDING' || run.status === 'READY_TO_CALCULATE'
  const canApprove = run.status === 'CALCULATED'
  const canMarkPaid = run.status === 'APPROVED'
  const canClose = run.status === 'PAID'
  const isLocked = run.status === 'LOCKED'

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: 6 }}>
            <Link to="/admin/payroll" className="muted" style={{ textDecoration: 'none' }}>
              ← Back
            </Link>
            <h1 className="page-title" style={{ margin: 0 }}>
              Payroll — {run.month}
            </h1>
          </div>
          <div className="page-subtitle">
            {run.employee_count} employees • {formatCurrency(run.total_net)} net payable
          </div>
        </div>
        <div className="header-actions" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {canCalculate && !isLocked && (
            <button
              onClick={() => handleAction(calculatePayrollRun, 'calculate payroll')}
              disabled={actionLoading}
            >
              Calculate Payroll
            </button>
          )}
          {canApprove && !isLocked && (
            <button
              onClick={() => handleAction(approvePayrollRun, 'approve run')}
              disabled={actionLoading}
              className="ok"
            >
              Approve
            </button>
          )}
          {canMarkPaid && !isLocked && (
            <button
              onClick={() => handleAction(markPayrollRunPaid, 'mark as paid')}
              disabled={actionLoading}
            >
              Mark Paid
            </button>
          )}
          {canClose && !isLocked && (
            <button
              onClick={() => handleAction(closePayrollRun, 'close and lock run')}
              disabled={actionLoading}
              className="secondary"
            >
              Close & Lock
            </button>
          )}
          <button className="ghost" onClick={() => handleExport('summary')}>
            Export
          </button>
        </div>
      </div>

      {/* Status Stepper */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem 0' }}>
          {STATUS_STEPS.map((step, index) => {
            const isActive = index <= currentStepIndex
            const isCurrent = step.key === run.status
            return (
              <React.Fragment key={step.key}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: isActive ? 'var(--accent)' : 'var(--surface-2)',
                      color: isActive ? 'white' : 'var(--text-muted)',
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      border: isCurrent ? '2px solid var(--accent-2)' : 'none'
                    }}
                  >
                    {index + 1}
                  </div>
                  <div style={{ fontSize: '0.9rem', fontWeight: isCurrent ? 600 : 400 }}>
                    {step.label}
                  </div>
                </div>
                {index < STATUS_STEPS.length - 1 && (
                  <div
                    style={{
                      flex: 1,
                      height: 2,
                      background: isActive ? 'var(--accent)' : 'var(--border)',
                      minWidth: 40
                    }}
                  />
                )}
              </React.Fragment>
            )
          })}
        </div>
      </div>

      {/* Tabs */}
      <div className="card" style={{ marginBottom: '0.5rem' }}>
        <div className="toolbar" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? '' : 'ghost'}
              onClick={() => setActiveTab(tab.id)}
              style={{
                borderRadius: 0,
                borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="card">
        {activeTab === 'overview' && <OverviewTab run={run} formatCurrency={formatCurrency} />}
        {activeTab === 'line-items' && (
          <LineItemsTab
            lineItems={run.line_items || []}
            formatCurrency={formatCurrency}
            onSelectEmployee={setSelectedEmployee}
          />
        )}
        {activeTab === 'payslips' && (
          <PayslipsTab payslips={run.payslips || []} formatCurrency={formatCurrency} formatDate={formatDate} />
        )}
        {activeTab === 'attendance' && <AttendanceTab run={run} />}
        {activeTab === 'audit' && <AuditTab run={run} formatDate={formatDate} />}
        {activeTab === 'exports' && <ExportsTab run={run} onExport={handleExport} />}
      </div>

      {/* Employee Detail Drawer */}
      {selectedEmployee && (
        <EmployeeDrawer employee={selectedEmployee} onClose={() => setSelectedEmployee(null)} formatCurrency={formatCurrency} />
      )}
    </div>
  )
}

// Overview Tab Component
function OverviewTab({ run, formatCurrency }) {
  const exceptions = run.exceptions || []
  const hasExceptions = run.exception_count > 0 || exceptions.length > 0

  return (
    <div className="grid" style={{ gap: '1.5rem' }}>
      {/* KPI Tiles */}
      <div className="grid cols-4">
        <div className="card tight">
          <div className="kicker">Headcount</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>{run.employee_count}</div>
          <div className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>employees</div>
        </div>

        <div className="card tight">
          <div className="kicker">Gross Pay</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>{formatCurrency(run.total_gross)}</div>
          <div className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>before deductions</div>
        </div>

        <div className="card tight">
          <div className="kicker">Total Deductions</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--warn)' }}>
            {formatCurrency(run.total_deductions)}
          </div>
          <div className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
            PF + ESI + PT + TDS
          </div>
        </div>

        <div className="card tight">
          <div className="kicker">Net Payable</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--accent-2)' }}>
            {formatCurrency(run.total_net)}
          </div>
          <div className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>cash required</div>
        </div>
      </div>

      {/* Statutory Breakdown */}
      <div className="card">
        <h3>Statutory Totals</h3>
        <table>
          <thead>
            <tr>
              <th>Component</th>
              <th style={{ textAlign: 'right' }}>Employee</th>
              <th style={{ textAlign: 'right' }}>Employer</th>
              <th style={{ textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Provident Fund (PF)</td>
              <td style={{ textAlign: 'right' }}>{formatCurrency(run.total_pf_employee)}</td>
              <td style={{ textAlign: 'right' }}>{formatCurrency(run.total_pf_employer)}</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>
                {formatCurrency(run.total_pf_employee + run.total_pf_employer)}
              </td>
            </tr>
            <tr>
              <td>ESI</td>
              <td style={{ textAlign: 'right' }}>{formatCurrency(run.total_esi_employee)}</td>
              <td style={{ textAlign: 'right' }}>{formatCurrency(run.total_esi_employer)}</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>
                {formatCurrency(run.total_esi_employee + run.total_esi_employer)}
              </td>
            </tr>
            <tr>
              <td>Professional Tax (PT)</td>
              <td style={{ textAlign: 'right' }}>{formatCurrency(run.total_pt)}</td>
              <td style={{ textAlign: 'right' }}>-</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(run.total_pt)}</td>
            </tr>
            <tr>
              <td>TDS</td>
              <td style={{ textAlign: 'right' }}>{formatCurrency(run.total_tds)}</td>
              <td style={{ textAlign: 'right' }}>-</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(run.total_tds)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Exceptions Panel */}
      {hasExceptions && (
        <div className="card" style={{ borderLeft: '3px solid var(--warn)' }}>
          <h3 style={{ color: 'var(--warn)' }}>⚠️ Exceptions Require Attention ({run.exception_count})</h3>
          <div className="muted" style={{ marginBottom: '1rem' }}>
            The following issues must be resolved before payroll can be finalized
          </div>
          <div className="grid">
            {exceptions.map((exc, i) => (
              <div key={i} className="list-item" style={{ background: 'var(--surface-2)' }}>
                <div style={{ fontWeight: 600 }}>{exc.employee_name || exc.type}</div>
                <div className="muted" style={{ fontSize: '0.9rem', marginTop: 4 }}>{exc.message}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {run.notes && (
        <div className="card">
          <h3>Notes</h3>
          <div style={{ whiteSpace: 'pre-wrap' }}>{run.notes}</div>
        </div>
      )}
    </div>
  )
}

// Line Items Tab Component
function LineItemsTab({ lineItems, formatCurrency, onSelectEmployee }) {
  const [search, setSearch] = useState('')

  const filtered = lineItems.filter(item =>
    item.user?.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    item.user?.email?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: '1rem' }}>
        <input
          type="text"
          placeholder="Search employees..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="muted" style={{ marginLeft: 'auto' }}>
          {filtered.length} of {lineItems.length} employees
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">No payroll line items found</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th style={{ textAlign: 'right' }}>Days Payable</th>
              <th style={{ textAlign: 'right' }}>Days LOP</th>
              <th style={{ textAlign: 'right' }}>Gross</th>
              <th style={{ textAlign: 'right' }}>Deductions</th>
              <th style={{ textAlign: 'right' }}>Net</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => (
              <tr key={item.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{item.user?.full_name || item.user?.email}</div>
                  <div className="muted" style={{ fontSize: '0.85rem' }}>{item.user?.email}</div>
                </td>
                <td style={{ textAlign: 'right' }}>{item.days_payable}</td>
                <td style={{ textAlign: 'right' }}>{item.days_lop > 0 ? item.days_lop : '-'}</td>
                <td style={{ textAlign: 'right' }}>{formatCurrency(item.gross_pay)}</td>
                <td style={{ textAlign: 'right' }}>{formatCurrency(item.deductions_total)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(item.net_pay)}</td>
                <td>
                  {item.has_exceptions ? (
                    <span className="badge warn">Exception</span>
                  ) : item.override_applied ? (
                    <span className="badge info">Adjusted</span>
                  ) : (
                    <span className="badge ok">Generated</span>
                  )}
                </td>
                <td>
                  <button className="ghost" onClick={() => onSelectEmployee(item)}>
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// Payslips Tab Component
function PayslipsTab({ payslips, formatCurrency, formatDate }) {
  return (
    <div>
      {payslips.length === 0 ? (
        <div className="empty">
          <div style={{ marginBottom: 8 }}>No payslips generated yet</div>
          <div className="muted" style={{ fontSize: '0.9rem' }}>
            Payslips will be generated after payroll is calculated
          </div>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Payslip #</th>
              <th>Employee</th>
              <th style={{ textAlign: 'right' }}>Net Pay</th>
              <th>Generated</th>
              <th>Delivery</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {payslips.map(slip => (
              <tr key={slip.id}>
                <td style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>{slip.payslip_number}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{slip.user?.full_name || slip.user?.email}</div>
                </td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>
                  {formatCurrency(slip.line_item?.net_pay)}
                </td>
                <td className="muted">{formatDate(slip.generated_at)}</td>
                <td>
                  {slip.email_sent ? (
                    <span className="badge ok">Sent</span>
                  ) : (
                    <span className="badge muted">Pending</span>
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button className="ghost" style={{ padding: '0.35rem 0.65rem' }}>
                      Preview
                    </button>
                    <button className="ghost" style={{ padding: '0.35rem 0.65rem' }}>
                      Download
                    </button>
                    {!slip.email_sent && (
                      <button className="ghost" style={{ padding: '0.35rem 0.65rem' }}>
                        Send Email
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// Attendance Tab Component
function AttendanceTab({ run }) {
  const [filter, setFilter] = React.useState('all') // all, absent, exceptions
  
  if (!run.line_items || run.line_items.length === 0) {
    return <div className="empty">No payroll line items. Please calculate payroll first.</div>
  }

  const stats = {
    total: run.line_items.length,
    presentDays: Math.round(
      run.line_items.reduce((sum, li) => sum + (li.days_payable || 0), 0) / run.line_items.length
    ),
    lopDays: Math.round(
      run.line_items.reduce((sum, li) => sum + (li.days_lop || 0), 0) / run.line_items.length
    ),
    avgGross: Math.round(
      run.line_items.reduce((sum, li) => sum + (li.gross_pay || 0), 0) / run.line_items.length
    )
  }

  return (
    <div className="grid" style={{ gap: '1.5rem' }}>
      {/* Attendance Stats */}
      <div className="grid cols-4">
        <div className="card tight">
          <div className="kicker">Total Employees</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>{stats.total}</div>
        </div>
        <div className="card tight">
          <div className="kicker">Avg Working Days</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>{stats.presentDays}</div>
        </div>
        <div className="card tight">
          <div className="kicker">Avg LOP Days</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--warn)' }}>{stats.lopDays}</div>
        </div>
        <div className="card tight">
          <div className="kicker">Avg Gross Pay</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>₹{stats.avgGross.toLocaleString('en-IN')}</div>
        </div>
      </div>

      {/* Daily Attendance Table */}
      <div className="card">
        <h3>Employee Attendance Summary</h3>
        <p className="muted" style={{ marginTop: 0, marginBottom: '1rem' }}>
          Daily attendance breakdown for payroll period. Days marked as per work sessions and approved leaves.
        </p>
        <table>
          <thead>
            <tr>
              <th style={{ width: '30%' }}>Employee Name</th>
              <th style={{ textAlign: 'center' }}>Days Present</th>
              <th style={{ textAlign: 'center' }}>LOP Days</th>
              <th style={{ textAlign: 'center' }}>OT Hours</th>
              <th style={{ textAlign: 'right' }}>Gross Pay</th>
              <th style={{ textAlign: 'right' }}>Net Pay</th>
            </tr>
          </thead>
          <tbody>
            {run.line_items.map((li, idx) => (
              <tr key={idx}>
                <td style={{ fontWeight: 500 }}>{li.user?.full_name || li.user?.email || `Employee ${li.user_id}`}</td>
                <td style={{ textAlign: 'center' }}>{Math.round(li.days_payable || 0)}</td>
                <td style={{ textAlign: 'center', color: li.days_lop > 0 ? 'var(--warn)' : 'var(--text)' }}>
                  {Math.round(li.days_lop || 0)}
                </td>
                <td style={{ textAlign: 'center' }}>{Math.round((li.overtime_minutes || 0) / 60)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>
                  ₹{Math.round(li.gross_pay || 0).toLocaleString('en-IN')}
                </td>
                <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--accent-2)' }}>
                  ₹{Math.round(li.net_pay || 0).toLocaleString('en-IN')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Notes on Attendance */}
      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <h4 style={{ marginTop: 0 }}>📋 Attendance Guidelines</h4>
        <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem', fontSize: '0.95rem' }}>
          <li>Days Present = days with ≥2 hours of work logged</li>
          <li>LOP Days = days absent or insufficient attendance (unpaid)</li>
          <li>OT Hours = extra hours worked beyond 8h/day (if approved)</li>
          <li>Sundays are excluded from payable days (weekly off)</li>
          <li>Holidays marked in policy are paid rest days</li>
        </ul>
      </div>
    </div>
  )
}

// Audit Tab Component
function AuditTab({ run, formatDate }) {
  const auditEvents = [
    run.created_at && { action: 'Run Created', by: run.creator?.full_name, at: run.created_at },
    run.calculated_at && { action: 'Payroll Calculated', by: 'System', at: run.calculated_at },
    run.approved_at && { action: 'Run Approved', by: run.approver?.full_name, at: run.approved_at },
    run.paid_at && { action: 'Marked as Paid', by: run.payer?.full_name, at: run.paid_at },
    run.locked_at && { action: 'Run Closed & Locked', by: run.locker?.full_name, at: run.locked_at },
  ].filter(Boolean)

  return (
    <div>
      {auditEvents.length === 0 ? (
        <div className="empty">No audit events yet</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th>Performed By</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {auditEvents.map((event, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 600 }}>{event.action}</td>
                <td>{event.by || '-'}</td>
                <td className="muted">{formatDate(event.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// Exports Tab Component
function ExportsTab({ run, onExport }) {
  const exports = [
    { type: 'summary', label: 'Payroll Run Summary', description: 'Complete payroll summary with all line items' },
    { type: 'bank-transfer', label: 'Bank Transfer Sheet', description: 'Net pay list for NEFT/RTGS transfer' },
    { type: 'statutory', label: 'Statutory Summary', description: 'PF, ESI, PT, TDS totals for compliance' },
    { type: 'payroll-register', label: 'Payroll Register', description: 'Detailed register for audit purposes' },
  ]

  return (
    <div className="grid">
      {exports.map(exp => (
        <div key={exp.type} className="card tight" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{exp.label}</div>
            <div className="muted" style={{ fontSize: '0.9rem' }}>{exp.description}</div>
          </div>
          <button onClick={() => onExport(exp.type)}>
            Download CSV
          </button>
        </div>
      ))}
    </div>
  )
}

// Employee Detail Drawer Component
function EmployeeDrawer({ employee, onClose, formatCurrency }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: 600, maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>{employee.user?.full_name || employee.user?.email}</h3>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>

        <div className="grid">
          {/* Salary Breakdown */}
          <div className="card tight">
            <div className="kicker">Salary Breakdown</div>
            <table style={{ marginTop: '0.75rem' }}>
              <tbody>
                <tr>
                  <td>Base Monthly Salary</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {formatCurrency(employee.base_monthly_salary)}
                  </td>
                </tr>
                <tr>
                  <td>Days Payable × Daily Rate</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(employee.base_pay)}</td>
                </tr>
                <tr>
                  <td>Overtime Pay</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(employee.overtime_pay)}</td>
                </tr>
                <tr>
                  <td style={{ paddingTop: '0.5rem', fontWeight: 600 }}>Gross Pay</td>
                  <td style={{ paddingTop: '0.5rem', textAlign: 'right', fontWeight: 600 }}>
                    {formatCurrency(employee.gross_pay)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Attendance Breakdown */}
          <div className="card tight">
            <div className="kicker">Attendance Breakdown</div>
            <table style={{ marginTop: '0.75rem' }}>
              <tbody>
                <tr>
                  <td>Days Payable</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{employee.days_payable}</td>
                </tr>
                <tr>
                  <td>Days LOP</td>
                  <td style={{ textAlign: 'right', color: 'var(--warn)' }}>{employee.days_lop}</td>
                </tr>
                <tr>
                  <td>Days Present</td>
                  <td style={{ textAlign: 'right' }}>{employee.days_present}</td>
                </tr>
                <tr>
                  <td>Overtime Minutes</td>
                  <td style={{ textAlign: 'right' }}>{employee.overtime_minutes || 0}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Deductions */}
          <div className="card tight">
            <div className="kicker">Deductions</div>
            <table style={{ marginTop: '0.75rem' }}>
              <tbody>
                <tr>
                  <td>PF (Employee)</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(employee.pf_employee)}</td>
                </tr>
                <tr>
                  <td>ESI (Employee)</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(employee.esi_employee)}</td>
                </tr>
                <tr>
                  <td>Professional Tax</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(employee.pt)}</td>
                </tr>
                <tr>
                  <td>TDS</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(employee.tds)}</td>
                </tr>
                <tr>
                  <td>Other Deductions</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(employee.other_deductions)}</td>
                </tr>
                <tr>
                  <td style={{ paddingTop: '0.5rem', fontWeight: 600 }}>Total Deductions</td>
                  <td style={{ paddingTop: '0.5rem', textAlign: 'right', fontWeight: 600, color: 'var(--warn)' }}>
                    {formatCurrency(employee.deductions_total)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Net Pay */}
          <div className="card tight" style={{ background: 'var(--surface-elevated)' }}>
            <div className="kicker">Net Pay</div>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--accent-2)', marginTop: '0.5rem' }}>
              {formatCurrency(employee.net_pay)}
            </div>
          </div>

          {/* Notes */}
          {employee.notes && (
            <div className="card tight">
              <div className="kicker">Notes</div>
              <div style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>{employee.notes}</div>
            </div>
          )}

          {/* Exception Details */}
          {employee.has_exceptions && employee.exception_details && (
            <div className="card tight" style={{ borderLeft: '3px solid var(--warn)' }}>
              <div className="kicker" style={{ color: 'var(--warn)' }}>⚠️ Exception</div>
              <div style={{ marginTop: '0.5rem' }}>{employee.exception_details}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
