import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import { fetchDashboardOverview } from '../../api/dashboard'
import { toUserMessage } from '../../api/client'
import InfoTip from '../../components/ui/InfoTip'

export default function AdminDashboard() {
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function loadOverview() {
      setLoading(true)
      setError(null)
      try {
        const data = await fetchDashboardOverview()
        if (!cancelled) setOverview(data)
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load dashboard overview'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadOverview()
    return () => {
      cancelled = true
    }
  }, [])

  const workloadRows = useMemo(() => {
    if (!overview?.workload) return []
    return [...overview.workload].sort((a, b) => {
      if (b.overdue !== a.overdue) return b.overdue - a.overdue
      return b.total_open - a.total_open
    })
  }, [overview])

  const summary = overview?.summary

  return (
    <div>
      <PageHeader
        title="Control Tower"
        subtitle="Real-time operational view across SLA, workload, approvals, and cashflow."
        actions={(
          <div style={{ display: 'flex', gap: 8 }}>
            <Badge tone="warn">{overview?.overdue_assignments ?? 0} overdue</Badge>
            <Link className="nav-link" to="/admin/workload">Open Workload</Link>
            <Link className="nav-link" to="/admin/open-queue">Open Queue</Link>
          </div>
        )}
      />

      {error ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{error}</div> : null}

      {loading ? (
        <div className="muted">Loading dashboard…</div>
      ) : !overview || !summary ? (
        <EmptyState>Dashboard data is not available.</EmptyState>
      ) : (
        <>
          <div className="grid cols-4" style={{ marginBottom: '0.95rem' }}>
            <SummaryCard label="Total Assignments" value={summary.total} help="All assignments visible to staff." />
            <SummaryCard label="Pending" value={summary.pending} tone="info" help="Open assignments (not completed or cancelled)." />
            <SummaryCard label="Overdue" value={summary.overdue} tone="danger" help="Assignments past their computed due time." />
            <SummaryCard label="Unpaid" value={summary.unpaid} tone="warn" help="Assignments with outstanding payments." />
          </div>

          <div className="grid cols-4" style={{ marginBottom: '1rem' }}>
            <SummaryCard label="Approvals Pending" value={overview.approvals_pending} tone="info" help="Requests waiting for decision." />
            <SummaryCard label="Payments Pending" value={overview.payments_pending} tone="warn" help="Invoices or assignments not marked paid." />
            <SummaryCard label="Overdue Radar" value={overview.overdue_assignments} tone="danger" help="Count of overdue assignments across the firm." />
            <SummaryCard label="Cash at Risk" value="—" tone="muted" help="Future: overdue payments total." />
          </div>

          <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(340px, 1fr)' }}>
            <Card>
              <CardHeader
                title="Workload Pressure"
                subtitle="Sorted by overdue exposure and open queue size."
                action={<Link to="/admin/workload" className="nav-link">Full Board</Link>}
              />

              {workloadRows.length === 0 ? (
                <EmptyState>No workload data yet.</EmptyState>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Open</th>
                        <th>Overdue</th>
                        <th>Due Soon</th>
                        <th>On Track</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workloadRows.slice(0, 12).map((row) => (
                        <tr key={row.user_id ?? row.user_email}>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <strong>{row.user_name || row.user_email || 'Unassigned'}</strong>
                              <span className="muted" style={{ fontSize: 12 }}>{row.user_email}</span>
                            </div>
                          </td>
                          <td>{row.total_open}</td>
                          <td>{row.overdue}</td>
                          <td>{row.due_soon}</td>
                          <td>{row.ok}</td>
                          <td>
                            {row.on_leave_today ? <Badge tone="warn">On Leave</Badge> : <Badge tone="ok">Available</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <div className="grid">
              <Card>
                <CardHeader title="Action Center" subtitle="Jump into the highest leverage workflows." />
                <div className="grid" style={{ gap: 8 }}>
                  <Link to="/admin/open-queue" className="nav-link">Open Queue</Link>
                  <Link to="/admin/approvals" className="nav-link">Approvals Inbox</Link>
                  <Link to="/admin/workload" className="nav-link">Rebalance Workload</Link>
                  <Link to="/admin/personnel" className="nav-link">Manage Personnel</Link>
                  <Link to="/admin/masterdata" className="nav-link">Master Data</Link>
                </div>
              </Card>

              <Card>
                <CardHeader title="Signals" subtitle="Key system pressures to monitor." />
                <div className="list">
                  <Signal label="Approvals Pending" value={overview.approvals_pending} tone={overview.approvals_pending > 0 ? 'info' : 'ok'} />
                  <Signal label="Payments Pending" value={overview.payments_pending} tone={overview.payments_pending > 0 ? 'warn' : 'ok'} />
                  <Signal label="Overdue Assignments" value={overview.overdue_assignments} tone={overview.overdue_assignments > 0 ? 'danger' : 'ok'} />
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, value, tone, help }) {
  const style = tone ? { color: `var(--${tone})` } : undefined
  return (
    <div className="card tight">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="kicker">{label}</div>
        {help ? <InfoTip text={help} /> : null}
      </div>
      <div className="stat-value" style={style}>{value}</div>
    </div>
  )
}

function Signal({ label, value, tone }) {
  return (
    <div className="list-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span className="muted">{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  )
}
