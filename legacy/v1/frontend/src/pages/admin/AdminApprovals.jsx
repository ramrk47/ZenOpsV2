import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import DataTable from '../../components/ui/DataTable'
import {
  approveApproval,
  fetchApproval,
  fetchApprovalsInbox,
  fetchApprovalsInboxCountsByType,
  rejectApproval,
} from '../../api/approvals'
import { formatDateTime, titleCase } from '../../utils/format'
import { toUserMessage } from '../../api/client'

const APPROVAL_TYPES = ['DRAFT_ASSIGNMENT', 'FINAL_DOC_REVIEW', 'PAYMENT_CONFIRMATION']
const APPROVAL_TYPE_LABELS = {
  DRAFT_ASSIGNMENT: 'Draft Assignments',
  FINAL_DOC_REVIEW: 'Final Document Review',
  PAYMENT_CONFIRMATION: 'Payment Confirmation',
}
const STATUS_FILTERS = ['PENDING', 'APPROVED', 'REJECTED']

function formatAge(value) {
  if (!value) return '—'
  const when = new Date(value)
  if (Number.isNaN(when.getTime())) return '—'
  const deltaMs = Date.now() - when.getTime()
  const minutes = Math.max(1, Math.floor(deltaMs / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function useNarrowLayout(maxWidth = 760) {
  const [isNarrow, setIsNarrow] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth <= maxWidth : false
  ))

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia(`(max-width: ${maxWidth}px)`)
    const handleChange = (event) => setIsNarrow(event.matches)
    setIsNarrow(media.matches)
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleChange)
      return () => media.removeEventListener('change', handleChange)
    }
    media.addListener(handleChange)
    return () => media.removeListener(handleChange)
  }, [maxWidth])

  return isNarrow
}

export default function AdminApprovals() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialType = searchParams.get('approvalType')
  const initialStatus = searchParams.get('status')

  const [approvals, setApprovals] = useState([])
  const [countsByType, setCountsByType] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeType, setActiveType] = useState(APPROVAL_TYPES.includes(initialType) ? initialType : 'DRAFT_ASSIGNMENT')
  const [statusFilter, setStatusFilter] = useState(STATUS_FILTERS.includes(initialStatus) ? initialStatus : 'PENDING')
  const [selectedApproval, setSelectedApproval] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [actionBusy, setActionBusy] = useState({ id: null, kind: null })
  const isNarrowLayout = useNarrowLayout()

  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('approvalType', activeType)
      next.set('status', statusFilter)
      return next
    }, { replace: true })
  }, [activeType, statusFilter, setSearchParams])

  useEffect(() => {
    let cancelled = false

    async function loadData() {
      setLoading(true)
      setError(null)
      try {
        const includeDecided = statusFilter !== 'PENDING'
        const [rows, counts] = await Promise.all([
          fetchApprovalsInbox(includeDecided, activeType, statusFilter),
          fetchApprovalsInboxCountsByType(APPROVAL_TYPES),
        ])
        if (cancelled) return
        setApprovals(rows)
        setCountsByType(counts)
        if (selectedApproval?.id) {
          const refreshed = rows.find((row) => row.id === selectedApproval.id)
          setSelectedApproval(refreshed || null)
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load requests inbox'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadData()
    return () => {
      cancelled = true
    }
  }, [activeType, statusFilter, reloadKey])

  const pendingCount = useMemo(
    () => APPROVAL_TYPES.reduce((sum, type) => sum + (countsByType[type] || 0), 0),
    [countsByType],
  )
  const selectedBusy = selectedApproval ? actionBusy.id === selectedApproval.id : false

  async function handleOpen(approval) {
    try {
      const detail = await fetchApproval(approval.id)
      setSelectedApproval(detail)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to load request detail'))
    }
  }

  async function handleApprove(approval) {
    if (!approval?.id || actionBusy.id === approval.id) return
    setError(null)
    setActionBusy({ id: approval.id, kind: 'approve' })
    try {
      const updated = await approveApproval(approval.id, null)
      setApprovals((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
      if (selectedApproval?.id === updated.id) {
        setSelectedApproval(updated)
      }
      setReloadKey((k) => k + 1)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to approve request'))
    } finally {
      setActionBusy({ id: null, kind: null })
    }
  }

  async function handleReject(approval) {
    if (!approval?.id || actionBusy.id === approval.id) return
    const reason = window.prompt('Rejection reason (required):')
    if (!reason || !reason.trim()) return
    setError(null)
    setActionBusy({ id: approval.id, kind: 'reject' })
    try {
      const updated = await rejectApproval(approval.id, reason.trim())
      setApprovals((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
      if (selectedApproval?.id === updated.id) {
        setSelectedApproval(updated)
      }
      setReloadKey((k) => k + 1)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to reject request'))
    } finally {
      setActionBusy({ id: null, kind: null })
    }
  }

  return (
    <div>
      <PageHeader
        title="Requests"
        subtitle="Single governance inbox for approvals and decisions."
        actions={<Badge tone={pendingCount > 0 ? 'warn' : 'ok'}>{pendingCount} pending</Badge>}
      />

      {error ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{error}</div> : null}

      <Card style={{ marginBottom: '0.9rem' }}>
        <CardHeader title="Rules" subtitle="Only these three items require approval." />
        <div className="list">
          <div className="list-item">Draft assignments created by Field Valuers need approval before permanent code allocation.</div>
          <div className="list-item">Final documents require review approval before they are locked as final.</div>
          <div className="list-item">Payments require confirmation approval before financial totals are impacted.</div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={APPROVAL_TYPE_LABELS[activeType]}
          subtitle={`Status filter: ${titleCase(statusFilter)}`}
          action={(
            <button
              type="button"
              className="secondary"
              disabled={loading}
              onClick={() => setReloadKey((k) => k + 1)}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
        />

        <div className="chip-row" style={{ marginBottom: '0.8rem' }}>
          {APPROVAL_TYPES.map((type) => {
            const isActive = activeType === type
            return (
            <button
              key={type}
              type="button"
              className={`chip ${isActive ? 'active' : ''}`.trim()}
              disabled={isActive}
              aria-pressed={isActive}
              onClick={() => {
                if (isActive) return
                setActiveType(type)
                setSelectedApproval(null)
              }}
            >
              {APPROVAL_TYPE_LABELS[type]}{' '}
              <Badge tone={(countsByType[type] || 0) > 0 ? 'warn' : 'ok'}>{countsByType[type] || 0}</Badge>
            </button>
            )
          })}
        </div>

        <div className="chip-row" style={{ marginBottom: '0.8rem' }}>
          {STATUS_FILTERS.map((status) => {
            const isActive = statusFilter === status
            return (
            <button
              key={status}
              type="button"
              className={`chip ${isActive ? 'active' : ''}`.trim()}
              disabled={isActive}
              aria-pressed={isActive}
              onClick={() => {
                if (isActive) return
                setStatusFilter(status)
                setSelectedApproval(null)
              }}
            >
              {titleCase(status)}
            </button>
            )
          })}
        </div>

        {loading ? (
          <DataTable loading columns={6} rows={8} />
        ) : approvals.length === 0 ? (
          <EmptyState>No requests in this filter.</EmptyState>
        ) : isNarrowLayout ? (
          <div className="grid" style={{ gap: '0.8rem' }}>
            {approvals.map((approval) => {
              const tone = approval.status === 'APPROVED' ? 'ok' : approval.status === 'REJECTED' ? 'danger' : 'warn'
              const requestedAt = approval.requested_at || approval.created_at
              const rowBusy = actionBusy.id === approval.id
              return (
                <div key={approval.id} className="list-item" style={{ gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block' }}>
                        {approval.entity_summary || `${approval.entity_type} #${approval.entity_id}`}
                      </strong>
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        #{approval.id} · {APPROVAL_TYPE_LABELS[approval.approval_type] || titleCase(approval.approval_type || approval.action_type)}
                      </div>
                    </div>
                    <Badge tone={tone}>{titleCase(approval.status)}</Badge>
                  </div>
                  <div className="grid" style={{ gap: 4 }}>
                    <div><strong>Requested By:</strong> {approval.requested_by_name || approval.requester_user_id}</div>
                    <div><strong>Age:</strong> {formatAge(requestedAt)}</div>
                    <div><strong>Requested:</strong> {formatDateTime(requestedAt)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="ghost" disabled={rowBusy} onClick={() => handleOpen(approval)}>Open</button>
                    {approval.status === 'PENDING' ? (
                      <>
                        <button type="button" className="secondary" disabled={rowBusy} onClick={() => handleApprove(approval)}>
                          {rowBusy && actionBusy.kind === 'approve' ? 'Approving…' : 'Approve'}
                        </button>
                        <button type="button" className="ghost" disabled={rowBusy} onClick={() => handleReject(approval)}>
                          {rowBusy && actionBusy.kind === 'reject' ? 'Rejecting…' : 'Reject'}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <DataTable>
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Requested By</th>
                  <th>Age</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {approvals.map((approval) => {
                  const tone = approval.status === 'APPROVED' ? 'ok' : approval.status === 'REJECTED' ? 'danger' : 'warn'
                  const requestedAt = approval.requested_at || approval.created_at
                  const rowBusy = actionBusy.id === approval.id
                  return (
                    <tr key={approval.id}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <strong>{approval.entity_summary || `${approval.entity_type} #${approval.entity_id}`}</strong>
                          <span className="muted" style={{ fontSize: 12 }}>#{approval.id} · {APPROVAL_TYPE_LABELS[approval.approval_type] || titleCase(approval.approval_type || approval.action_type)}</span>
                        </div>
                      </td>
                      <td>{approval.requested_by_name || approval.requester_user_id}</td>
                      <td>{formatAge(requestedAt)}</td>
                      <td><Badge tone={tone}>{titleCase(approval.status)}</Badge></td>
                      <td>{formatDateTime(requestedAt)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button type="button" className="ghost" disabled={rowBusy} onClick={() => handleOpen(approval)}>Open</button>
                          {approval.status === 'PENDING' ? (
                            <>
                              <button type="button" className="secondary" disabled={rowBusy} onClick={() => handleApprove(approval)}>
                                {rowBusy && actionBusy.kind === 'approve' ? 'Approving…' : 'Approve'}
                              </button>
                              <button type="button" className="ghost" disabled={rowBusy} onClick={() => handleReject(approval)}>
                                {rowBusy && actionBusy.kind === 'reject' ? 'Rejecting…' : 'Reject'}
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </DataTable>
        )}

        {selectedApproval ? (
          <div className="list-item" style={{ marginTop: '0.9rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong>Request #{selectedApproval.id}</strong>
              <Badge tone={selectedApproval.status === 'PENDING' ? 'warn' : selectedApproval.status === 'APPROVED' ? 'ok' : 'danger'}>
                {titleCase(selectedApproval.status)}
              </Badge>
            </div>
            <div className="grid" style={{ gap: 6 }}>
              <div><strong>Reference:</strong> {selectedApproval.entity_summary || `${selectedApproval.entity_type} #${selectedApproval.entity_id}`}</div>
              <div><strong>Requested By:</strong> {selectedApproval.requested_by_name || selectedApproval.requester_user_id}</div>
              <div><strong>Requested At:</strong> {formatDateTime(selectedApproval.requested_at || selectedApproval.created_at)}</div>
              <div><strong>Reason:</strong> {selectedApproval.reason || '—'}</div>
              <div><strong>Decision Reason:</strong> {selectedApproval.decision_reason || '—'}</div>
              <div>
                <strong>Entity Snapshot:</strong>
                <pre style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(selectedApproval.metadata_json || selectedApproval.payload_json || {}, null, 2)}
                </pre>
              </div>
            </div>
            {selectedApproval.status === 'PENDING' ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button type="button" className="secondary" disabled={selectedBusy} onClick={() => handleApprove(selectedApproval)}>
                  {selectedBusy && actionBusy.kind === 'approve' ? 'Approving…' : 'Approve'}
                </button>
                <button type="button" className="ghost" disabled={selectedBusy} onClick={() => handleReject(selectedApproval)}>
                  {selectedBusy && actionBusy.kind === 'reject' ? 'Rejecting…' : 'Reject'}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  )
}
