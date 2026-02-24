import React, { useState, useEffect } from 'react'
import { fetchPayrollRuns, exportPayrollRun } from '../../api/payroll'

export default function PayrollReports() {
  const [loading, setLoading] = useState(false)
  const [runs, setRuns] = useState([])
  const [selectedRun, setSelectedRun] = useState('')
  const [exporting, setExporting] = useState({})
  const [error, setError] = useState(null)

  useEffect(() => {
    loadRuns()
  }, [])

  async function loadRuns() {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchPayrollRuns({ limit: 100 })
      setRuns(data.runs || [])
      if (data.runs && data.runs.length > 0) {
        setSelectedRun(String(data.runs[0].id))
      }
    } catch (err) {
      console.error('Failed to load payroll runs:', err)
      setError(err.message || 'Failed to load payroll runs')
    } finally {
      setLoading(false)
    }
  }

  async function handleExport(exportType) {
    if (!selectedRun) {
      alert('Please select a payroll run')
      return
    }

    setExporting({ ...exporting, [exportType]: true })
    try {
      const blob = await exportPayrollRun(selectedRun, exportType)

      // Create download link
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url

      const run = runs.find(r => r.id === parseInt(selectedRun, 10))
      const month = run ? run.month : 'export'
      a.download = `payroll_${exportType}_${month}.csv`

      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to export:', err)
      alert(err.response?.data?.detail || 'Failed to export data')
    } finally {
      setExporting({ ...exporting, [exportType]: false })
    }
  }

  const EXPORT_TYPES = [
    {
      id: 'summary',
      label: 'Payroll Summary',
      description: 'Employee-wise payroll summary with gross, deductions, and net pay',
      icon: '📊',
    },
    {
      id: 'detailed',
      label: 'Detailed Breakdown',
      description: 'Complete breakdown of all salary components and deductions',
      icon: '📋',
    },
    {
      id: 'statutory',
      label: 'Statutory Report',
      description: 'PF, ESI, PT, TDS contributions for compliance filing',
      icon: '📑',
    },
    {
      id: 'bank',
      label: 'Bank Transfer File',
      description: 'CSV file formatted for bank salary transfers',
      icon: '🏦',
    },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Payroll Reports</h1>
          <div className="page-subtitle">Export payroll data and download reports</div>
        </div>
      </div>

      {/* Run Selection */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ marginBottom: '0.5rem', fontWeight: 600 }}>Select Payroll Run</div>
        {loading ? (
          <div className="muted">Loading payroll runs...</div>
        ) : error ? (
          <div className="muted" style={{ color: 'var(--warn)' }}>Error: {error}</div>
        ) : runs.length === 0 ? (
          <div className="muted">No payroll runs found</div>
        ) : (
          <select
            value={selectedRun}
            onChange={(e) => setSelectedRun(e.target.value)}
            style={{ maxWidth: '300px' }}
          >
            {runs.map(run => (
              <option key={run.id} value={run.id}>
                {run.month} - {run.status} ({run.employee_count} employees)
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Export Cards */}
      <div className="grid cols-2" style={{ gap: '1rem' }}>
        {EXPORT_TYPES.map(exportType => (
          <div key={exportType.id} className="card">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
              <div style={{ fontSize: '2rem', lineHeight: 1 }}>
                {exportType.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                  {exportType.label}
                </div>
                <div className="muted" style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
                  {exportType.description}
                </div>
                <button
                  onClick={() => handleExport(exportType.id)}
                  disabled={!selectedRun || exporting[exportType.id]}
                  className="secondary"
                >
                  {exporting[exportType.id] ? 'Exporting...' : 'Download CSV'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Help Section */}
      <div className="card" style={{ marginTop: '2rem', background: 'var(--surface-alt)' }}>
        <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>💡 Export Guide</div>
        <div className="muted" style={{ fontSize: '0.9rem' }}>
          <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
            <li><strong>Payroll Summary:</strong> Use for quick overview and management review</li>
            <li><strong>Detailed Breakdown:</strong> Use for accounting reconciliation and audits</li>
            <li><strong>Statutory Report:</strong> Use for PF, ESI, PT filing with government portals</li>
            <li><strong>Bank Transfer File:</strong> Upload directly to your bank's salary transfer portal</li>
          </ul>
          <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--bg)', borderRadius: '4px' }}>
            <strong>Note:</strong> All exports are in CSV format. Open with Excel or Google Sheets for easy viewing and processing.
          </div>
        </div>
      </div>

      {/* Recent Exports Log (Placeholder) */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div style={{ fontWeight: 600, marginBottom: '1rem' }}>Recent Exports</div>
        <div className="empty">
          <div className="muted">Export history tracking coming soon</div>
        </div>
      </div>
    </div>
  )
}
