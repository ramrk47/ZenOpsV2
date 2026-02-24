import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchPayrollRuns, fetchPayrollStats, createPayrollRun } from '../../api/payroll'

const STATUS_COLORS = {
  DRAFT: 'muted',
  TIME_PENDING: 'warn',
  READY_TO_CALCULATE: 'info',
  CALCULATED: 'info',
  APPROVED: 'ok',
  PAID: 'ok',
  LOCKED: 'muted',
}

const STATUS_LABELS = {
  DRAFT: 'Draft',
  TIME_PENDING: 'Time Pending',
  READY_TO_CALCULATE: 'Ready',
  CALCULATED: 'Calculated',
  APPROVED: 'Approved',
  PAID: 'Paid',
  LOCKED: 'Locked',
}

export default function PayrollRuns() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [runs, setRuns] = useState([])
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)

  // Filters
  const [monthFilter, setMonthFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // Create run modal
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createMonth, setCreateMonth] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    loadData()
  }, [monthFilter, statusFilter])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [runsData, statsData] = await Promise.all([
        fetchPayrollRuns({ month: monthFilter, status: statusFilter }),
        fetchPayrollStats().catch(() => null)
      ])
      setRuns(Array.isArray(runsData) ? runsData : runsData.runs || [])
      if (statsData) setStats(statsData)
    } catch (err) {
      console.error('Failed to load payroll data:', err)
      setError(err.message || 'Failed to load payroll data')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateRun() {
    if (!createMonth) {
      alert('Please select a month')
      return
    }

    setCreating(true)
    try {
      const newRun = await createPayrollRun({ month: createMonth })
      setShowCreateModal(false)
      setCreateMonth('')
      navigate(`/admin/payroll/runs/${newRun.id}`)
    } catch (err) {
      console.error('Failed to create payroll run:', err)
      alert(err.response?.data?.detail || 'Failed to create payroll run')
    } finally {
      setCreating(false)
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
    return new Date(dateStr).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Payroll Runs</h1>
          <div className="page-subtitle">Manage monthly payroll processing</div>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)}>
            + Create Payroll Run
          </button>
        </div>
      </div>

      {/* KPI Tiles */}
      {stats && (
        <div className="grid cols-4" style={{ marginBottom: '1.5rem' }}>
          <div className="card tight">
            <div className="kicker" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              This Month Net Payable
              <span className="help-icon" title="Total net payable amount for current month">ⓘ</span>
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-2)' }}>
              {formatCurrency(stats.current_month_net)}
            </div>
            <div className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
              {stats.current_month_employees || 0} employees
            </div>
          </div>

          <div className="card tight">
            <div className="kicker" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              Pending Approval
              <span className="help-icon" title="Payroll runs calculated and awaiting approval">ⓘ</span>
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>
              {stats.pending_approval || 0}
            </div>
            <div className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
              runs awaiting approval
            </div>
          </div>

          <div className="card tight">
            <div className="kicker" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              Paid This Month
              <span className="help-icon" title="Completed payroll runs marked as paid">ⓘ</span>
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--ok)' }}>
              {stats.paid_runs || 0}
            </div>
            <div className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
              completed payroll runs
            </div>
          </div>

          <div className="card tight">
            <div className="kicker" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              Exceptions
              <span className="help-icon" title="Payroll items with attendance or calculation issues">ⓘ</span>
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: stats.exceptions > 0 ? 'var(--warn)' : 'var(--text)' }}>
              {stats.exceptions || 0}
            </div>
            <div className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
              require attention
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="toolbar">
          <input
            id="monthFilter"
            name="monthFilter"
            type="month"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            placeholder="Filter by month"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="TIME_PENDING">Time Pending</option>
            <option value="READY_TO_CALCULATE">Ready</option>
            <option value="CALCULATED">Calculated</option>
            <option value="APPROVED">Approved</option>
            <option value="PAID">Paid</option>
            <option value="LOCKED">Locked</option>
          </select>
          {(monthFilter || statusFilter) && (
            <button
              className="ghost"
              onClick={() => {
                setMonthFilter('')
                setStatusFilter('')
              }}
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Runs Table */}
      <div className="card">
        {loading ? (
          <div className="empty">Loading payroll runs...</div>
        ) : error ? (
          <div className="empty">Error: {error}</div>
        ) : runs.length === 0 ? (
          <div className="empty">
            <div style={{ marginBottom: 8 }}>No payroll runs found</div>
            <button onClick={() => setShowCreateModal(true)}>
              Create Your First Payroll Run
            </button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Employees</th>
                <th style={{ textAlign: 'right' }}>Gross</th>
                <th style={{ textAlign: 'right' }}>Deductions</th>
                <th style={{ textAlign: 'right' }}>Net Payable</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <Link to={`/admin/payroll/runs/${run.id}`} style={{ fontWeight: 600 }}>
                      {run.month}
                    </Link>
                  </td>
                  <td>
                    <span className={`badge ${STATUS_COLORS[run.status]}`}>
                      {STATUS_LABELS[run.status]}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{run.employee_count}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(run.total_gross)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(run.total_deductions)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {formatCurrency(run.total_net)}
                  </td>
                  <td className="muted">{formatDate(run.created_at)}</td>
                  <td>
                    <Link
                      to={`/admin/payroll/runs/${run.id}`}
                      className="nav-link"
                      style={{ display: 'inline-block', padding: '0.35rem 0.65rem' }}
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Run Modal */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => !creating && setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Create Payroll Run</h3>
            <div className="grid" style={{ marginTop: '1rem' }}>
              <label className="grid">
                <span className="muted">Select Month</span>
                <input
                  id="createMonth"
                  name="createMonth"
                  type="month"
                  value={createMonth}
                  onChange={(e) => setCreateMonth(e.target.value)}
                  disabled={creating}
                  required
                />
              </label>

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  onClick={handleCreateRun}
                  disabled={!createMonth || creating}
                >
                  {creating ? 'Creating...' : 'Create Run'}
                </button>
                <button
                  className="secondary"
                  onClick={() => setShowCreateModal(false)}
                  disabled={creating}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
