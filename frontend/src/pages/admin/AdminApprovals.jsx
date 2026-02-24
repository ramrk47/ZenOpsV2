import React, { useEffect, useMemo, useState } from 'react'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import DataTable from '../../components/ui/DataTable'
import { fetchApprovalsInbox, approveApproval, rejectApproval } from '../../api/approvals'
import { fetchLeaveInbox, approveLeave, rejectLeave } from '../../api/leave'
import { fetchUsers } from '../../api/users'
import {
  fetchAdminCommissions,
  fetchAdminCommissionBillingStatus,
  approveAdminCommission,
  rejectAdminCommission,
  needsInfoAdminCommission
} from '../../api/partnerAdmin'
import { formatDate, formatDateTime, titleCase } from '../../utils/format'
import { toUserMessage } from '../../api/client'
import { loadJson, saveJson } from '../../utils/storage'

const FILTERS_KEY = 'zenops.approvals.filters.v1'

export default function AdminApprovals() {
  const [approvals, setApprovals] = useState([])
  const [leaves, setLeaves] = useState([])
  const [users, setUsers] = useState([])
  const [commissions, setCommissions] = useState([])
  const [commissionBilling, setCommissionBilling] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [commissionError, setCommissionError] = useState(null)
  const storedFilters = loadJson(FILTERS_KEY, { includeDecided: false, sectionFilter: 'ALL' })
  const [includeDecided, setIncludeDecided] = useState(Boolean(storedFilters.includeDecided))
  const [reloadKey, setReloadKey] = useState(0)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sectionFilter, setSectionFilter] = useState(storedFilters.sectionFilter || 'ALL')

  useEffect(() => {
    saveJson(FILTERS_KEY, { includeDecided, sectionFilter })
  }, [includeDecided, sectionFilter])

  useEffect(() => {
    let cancelled = false

    async function loadData() {
      setLoading(true)
      setError(null)
      setCommissionError(null)
      try {
        const [approvalData, leaveData, userData, commissionData] = await Promise.all([
          fetchApprovalsInbox(includeDecided),
          fetchLeaveInbox().catch(() => []),
          fetchUsers(),
          fetchAdminCommissions().catch(() => []),
        ])
        if (cancelled) return
        setApprovals(approvalData)
        setLeaves(leaveData)
        setUsers(userData)
        setCommissions(commissionData)
        const openCommissionIds = commissionData
          .filter((row) => ['SUBMITTED', 'NEEDS_INFO'].includes(row.status))
          .map((row) => row.id)
        const billingEntries = await Promise.all(
          openCommissionIds.map(async (commissionId) => {
            try {
              const status = await fetchAdminCommissionBillingStatus(commissionId)
              return [commissionId, status]
            } catch {
              return [commissionId, null]
            }
          })
        )
        if (!cancelled) {
          const mapped = {}
          billingEntries.forEach(([commissionId, status]) => {
            if (status) mapped[commissionId] = status
          })
          setCommissionBilling(mapped)
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load approvals inbox'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadData()
    return () => {
      cancelled = true
    }
  }, [includeDecided, reloadKey])

  const userMap = useMemo(() => {
    const map = new Map()
    users.forEach((u) => map.set(u.id, u))
    return map
  }, [users])

  const pendingApprovals = approvals.filter((a) => a.status === 'PENDING').length
  const pendingLeaves = leaves.filter((l) => l.status === 'PENDING').length
  const openCommissions = commissions.filter((c) => ['SUBMITTED', 'NEEDS_INFO'].includes(c.status))
  const pendingCount = pendingApprovals + pendingLeaves + openCommissions.length
  const showExternal = sectionFilter === 'ALL' || sectionFilter === 'EXTERNAL'
  const showApprovals = sectionFilter === 'ALL' || sectionFilter === 'APPROVALS'
  const showLeave = sectionFilter === 'ALL' || sectionFilter === 'LEAVE'

  async function handleApprove(approval) {
    try {
      const updated = await approveApproval(approval.id, null)
      setApprovals((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to approve request'))
    }
  }

  async function handleReject(approval) {
    const comment = window.prompt('Optional rejection reason:') || null
    try {
      const updated = await rejectApproval(approval.id, comment)
      setApprovals((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to reject request'))
    }
  }

  async function handleApproveLeaveRequest(leave) {
    try {
      const updated = await approveLeave(leave.id)
      setLeaves((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to approve leave'))
    }
  }

  async function handleRejectLeaveRequest(leave) {
    const comment = window.prompt('Optional rejection reason:') || null
    try {
      const updated = await rejectLeave(leave.id, comment)
      setLeaves((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to reject leave'))
    }
  }

  async function handleApproveCommission(commission) {
    try {
      const updated = await approveAdminCommission(commission.id, {})
      setCommissions((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    } catch (err) {
      console.error(err)
      setCommissionError(toUserMessage(err, 'Failed to approve commission'))
    }
  }

  async function handleRejectCommission(commission) {
    const reason = window.prompt('Rejection reason (visible to partner):') || ''
    try {
      const updated = await rejectAdminCommission(commission.id, { reason })
      setCommissions((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    } catch (err) {
      console.error(err)
      setCommissionError(toUserMessage(err, 'Failed to reject commission'))
    }
  }

  async function handleNeedsInfoCommission(commission) {
    const message = window.prompt('What additional info or documents are required?') || ''
    if (!message.trim()) return
    try {
      const updated = await needsInfoAdminCommission(commission.id, { message })
      setCommissions((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    } catch (err) {
      console.error(err)
      setCommissionError(toUserMessage(err, 'Failed to request more info'))
    }
  }

  return (
    <div>
      <PageHeader
        title="Approvals Inbox"
        subtitle="Govern sensitive actions without blocking day-to-day execution."
        actions={<Badge tone={pendingCount > 0 ? 'warn' : 'ok'}>{pendingCount} pending</Badge>}
      />

      {error ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{error}</div> : null}
      {commissionError ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{commissionError}</div> : null}

      <div className="filter-shell" style={{ marginBottom: '0.9rem' }}>
        <div className="toolbar dense">
          <div className="chip-row">
            <button
              type="button"
              className={`chip ${sectionFilter === 'ALL' ? 'active' : ''}`.trim()}
              onClick={() => setSectionFilter('ALL')}
              aria-pressed={sectionFilter === 'ALL'}
            >
              All
            </button>
            <button
              type="button"
              className={`chip ${sectionFilter === 'EXTERNAL' ? 'active' : ''}`.trim()}
              onClick={() => setSectionFilter('EXTERNAL')}
              aria-pressed={sectionFilter === 'EXTERNAL'}
            >
              External
            </button>
            <button
              type="button"
              className={`chip ${sectionFilter === 'APPROVALS' ? 'active' : ''}`.trim()}
              onClick={() => setSectionFilter('APPROVALS')}
              aria-pressed={sectionFilter === 'APPROVALS'}
            >
              Approvals
            </button>
            <button
              type="button"
              className={`chip ${sectionFilter === 'LEAVE' ? 'active' : ''}`.trim()}
              onClick={() => setSectionFilter('LEAVE')}
              aria-pressed={sectionFilter === 'LEAVE'}
            >
              Leave
            </button>
          </div>
          <button type="button" className="secondary" onClick={() => setFiltersOpen((open) => !open)}>
            {filtersOpen ? 'Hide Filters' : 'Filters'}
          </button>
          <Badge tone="info">{pendingCount} pending</Badge>
        </div>
        {filtersOpen ? (
          <div className="filter-panel">
            <div className="filter-grid">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={includeDecided} onChange={(e) => setIncludeDecided(e.target.checked)} />
                <span className="kicker" style={{ marginTop: 2 }}>Include decided</span>
              </label>
              <button type="button" className="secondary" onClick={() => setReloadKey((k) => k + 1)}>Refresh</button>
            </div>
          </div>
        ) : null}
      </div>

      {showExternal ? (
        <Card>
          <CardHeader
            title="External Requests Inbox"
            subtitle="Commission requests submitted by external partners."
            action={<Badge tone={openCommissions.length > 0 ? 'warn' : 'ok'}>{openCommissions.length} open</Badge>}
          />
          {loading ? (
            <DataTable loading columns={7} rows={6} />
          ) : commissions.length === 0 ? (
            <EmptyState>No external commission requests.</EmptyState>
          ) : (
            <DataTable>
              <table>
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Status</th>
                    <th>Borrower</th>
                    <th>Bank</th>
                    <th>Billing</th>
                    <th>Updated</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((commission) => (
                    <tr key={commission.id}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <strong>{commission.request_code}</strong>
                          <span className="muted" style={{ fontSize: 12 }}>#{commission.id}</span>
                        </div>
                      </td>
                      <td><Badge tone={commission.status === 'REJECTED' ? 'danger' : commission.status === 'NEEDS_INFO' ? 'warn' : 'info'}>{titleCase(commission.status)}</Badge></td>
                      <td>{commission.borrower_name || '—'}</td>
                      <td>{commission.bank_name || '—'}</td>
                      <td>
                        {(() => {
                          const billing = commissionBilling[commission.id]
                          if (!billing) {
                            return <span className="muted" style={{ fontSize: 12 }}>—</span>
                          }
                          const mode = String(billing.billing_mode || 'POSTPAID').toUpperCase()
                          if (mode !== 'CREDIT') {
                            return <Badge tone="info">POSTPAID</Badge>
                          }
                          const available = Number(billing?.credit?.available || 0)
                          const tone = available > 0 ? 'ok' : 'warn'
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <Badge tone={tone}>CREDIT · {available} available</Badge>
                              {available <= 0 ? <span className="muted" style={{ fontSize: 11 }}>Top-up required</span> : null}
                            </div>
                          )
                        })()}
                      </td>
                      <td>{formatDateTime(commission.updated_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {(() => {
                          const billing = commissionBilling[commission.id]
                          const insufficientCredits = Boolean(
                            billing &&
                              String(billing.billing_mode || '').toUpperCase() === 'CREDIT' &&
                              Number(billing?.credit?.available || 0) <= 0
                          )
                          if (commission.status === 'SUBMITTED') {
                            return (
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => handleApproveCommission(commission)}
                              disabled={insufficientCredits}
                              title={insufficientCredits ? 'Credit mode active with insufficient available credits' : ''}
                            >
                              Approve
                            </button>
                            <button type="button" className="ghost" onClick={() => handleNeedsInfoCommission(commission)}>Needs Info</button>
                            <button type="button" className="ghost" onClick={() => handleRejectCommission(commission)}>Reject</button>
                          </div>
                            )
                          }
                          if (commission.status === 'NEEDS_INFO') {
                            return (
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={() => handleApproveCommission(commission)}
                                  disabled={insufficientCredits}
                                  title={insufficientCredits ? 'Credit mode active with insufficient available credits' : ''}
                                >
                                  Approve
                                </button>
                                <button type="button" className="ghost" onClick={() => handleRejectCommission(commission)}>Reject</button>
                              </div>
                            )
                          }
                          return <span className="muted" style={{ fontSize: 12 }}>Closed</span>
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>
          )}
        </Card>
      ) : null}

      {showApprovals ? (
        <Card>
          <CardHeader
            title="Requests"
            subtitle={includeDecided ? 'Showing pending + decided approvals' : 'Showing pending approvals'}
            action={<Badge tone={pendingApprovals > 0 ? 'warn' : 'ok'}>{pendingApprovals} pending</Badge>}
          />

          {loading ? (
            <DataTable loading columns={7} rows={7} />
          ) : approvals.length === 0 ? (
            <EmptyState>No approvals in the inbox.</EmptyState>
          ) : (
            <DataTable>
              <table className="approvals-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Requester</th>
                    <th className="col-reason">Reason</th>
                    <th className="col-created">Created</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {approvals.map((approval) => {
                    const requester = userMap.get(approval.requester_user_id)
                    const approver = approval.approver_user_id ? userMap.get(approval.approver_user_id) : null
                    const isPending = approval.status === 'PENDING'
                    const tone = approval.status === 'APPROVED' ? 'ok' : approval.status === 'REJECTED' ? 'danger' : 'warn'
                    return (
                      <tr key={approval.id}>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <strong>{titleCase(approval.action_type)}</strong>
                            <span className="muted" style={{ fontSize: 12 }}>{titleCase(approval.entity_type)}</span>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span>#{approval.entity_id}</span>
                            {approval.assignment_id ? (
                              <span className="muted" style={{ fontSize: 12 }}>Assignment #{approval.assignment_id}</span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span>{requester?.full_name || requester?.email || approval.requester_user_id}</span>
                            <span className="muted" style={{ fontSize: 12 }}>
                              {approver ? `Approver: ${approver.full_name || approver.email}` : 'Unassigned approver'}
                            </span>
                          </div>
                        </td>
                        <td className="col-reason">{approval.reason || '—'}</td>
                        <td className="col-created">{formatDateTime(approval.created_at)}</td>
                        <td><Badge tone={tone}>{titleCase(approval.status)}</Badge></td>
                        <td style={{ textAlign: 'right' }}>
                          {isPending ? (
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button type="button" className="secondary" onClick={() => handleApprove(approval)}>Approve</button>
                              <button type="button" className="ghost" onClick={() => handleReject(approval)}>Reject</button>
                            </div>
                          ) : (
                            <span className="muted" style={{ fontSize: 12 }}>{approval.decided_at ? formatDateTime(approval.decided_at) : 'Decided'}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </DataTable>
          )}
        </Card>
      ) : null}

      {showLeave ? (
        <Card>
          <CardHeader
            title="Leave Inbox"
            subtitle="Pending leave requests also drive calendar overlays and workload planning."
            action={<Badge tone={pendingLeaves > 0 ? 'warn' : 'ok'}>{pendingLeaves} pending</Badge>}
          />

          {loading ? (
            <DataTable loading columns={8} rows={6} />
          ) : leaves.length === 0 ? (
            <EmptyState>No leave requests in the inbox.</EmptyState>
          ) : (
            <DataTable>
              <table className="leave-approvals-table">
                <thead>
                  <tr>
                    <th>Requester</th>
                    <th>Type</th>
                    <th>Dates</th>
                    <th>Hours</th>
                    <th className="col-reason">Reason</th>
                    <th className="col-created">Created</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {leaves.map((leave) => {
                    const requester = userMap.get(leave.requester_user_id)
                    const isPending = leave.status === 'PENDING'
                    const tone = leave.status === 'APPROVED' ? 'ok' : leave.status === 'REJECTED' ? 'danger' : 'warn'
                    const dateLabel = leave.leave_type === 'PERMISSION_HOURS'
                      ? formatDate(leave.start_date)
                      : `${formatDate(leave.start_date)} → ${formatDate(leave.end_date || leave.start_date)}`
                    return (
                      <tr key={leave.id}>
                        <td>{requester?.full_name || requester?.email || leave.requester_user_id}</td>
                        <td>{titleCase(leave.leave_type)}</td>
                        <td>{dateLabel}</td>
                        <td>{leave.hours ?? '—'}</td>
                        <td className="col-reason">{leave.reason || '—'}</td>
                        <td className="col-created">{formatDateTime(leave.created_at)}</td>
                        <td><Badge tone={tone}>{titleCase(leave.status)}</Badge></td>
                        <td style={{ textAlign: 'right' }}>
                          {isPending ? (
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button type="button" className="secondary" onClick={() => handleApproveLeaveRequest(leave)}>Approve</button>
                              <button type="button" className="ghost" onClick={() => handleRejectLeaveRequest(leave)}>Reject</button>
                            </div>
                          ) : (
                            <span className="muted" style={{ fontSize: 12 }}>
                              {leave.decided_at ? formatDateTime(leave.decided_at) : 'Decided'}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </DataTable>
          )}
        </Card>
      ) : null}
    </div>
  )
}
