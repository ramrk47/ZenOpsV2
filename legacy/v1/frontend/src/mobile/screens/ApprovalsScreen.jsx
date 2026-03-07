import React, { useEffect, useMemo, useState } from 'react'
import MobileLayout from '../MobileLayout'
import { BottomSheet, Card, Chip, KVRow, MobileEmptyState, MobileListSkeleton, SearchBar, Section } from '../components/Primitives'
import {
  approveApproval,
  fetchApproval,
  fetchApprovalsInbox,
  fetchMyApprovals,
  rejectApproval,
} from '../../api/approvals'
import { formatDateTime, titleCase } from '../../utils/format'
import { useAuth } from '../../auth/AuthContext'
import { hasCapability } from '../../utils/rbac'
import { toUserMessage } from '../../api/client'

const STATUS_FILTERS = ['PENDING', 'APPROVED', 'REJECTED']

export default function ApprovalsScreen() {
  const { capabilities } = useAuth()
  const canApprove = hasCapability(capabilities, 'approve_actions')

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('PENDING')
  const [query, setQuery] = useState('')
  const [selectedApproval, setSelectedApproval] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        const data = canApprove
          ? await fetchApprovalsInbox(statusFilter !== 'PENDING', null, statusFilter)
          : await fetchMyApprovals(statusFilter !== 'PENDING')
        if (!cancelled) setRows(data || [])
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err, 'Unable to load approvals.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [canApprove, statusFilter])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => {
      const haystack = [
        row.entity_summary,
        row.assignment_code,
        row.invoice_number,
        row.requested_by_name,
        row.reason,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [rows, query])
  const stats = useMemo(() => ({
    pending: rows.filter((row) => String(row.status || '').toUpperCase() === 'PENDING').length,
    approved: rows.filter((row) => String(row.status || '').toUpperCase() === 'APPROVED').length,
    rejected: rows.filter((row) => String(row.status || '').toUpperCase() === 'REJECTED').length,
  }), [rows])

  async function openDetail(row) {
    setError('')
    try {
      const detail = await fetchApproval(row.id)
      setSelectedApproval(detail)
    } catch (err) {
      setError(toUserMessage(err, 'Unable to load approval detail.'))
    }
  }

  async function handleApprove() {
    if (!selectedApproval) return
    setBusy(true)
    try {
      const updated = await approveApproval(selectedApproval.id)
      setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
      setSelectedApproval(updated)
    } catch (err) {
      setError(toUserMessage(err, 'Approval action failed.'))
    } finally {
      setBusy(false)
    }
  }

  async function handleReject() {
    if (!selectedApproval) return
    const reason = window.prompt('Rejection reason')
    if (!reason || !reason.trim()) return
    setBusy(true)
    try {
      const updated = await rejectApproval(selectedApproval.id, reason.trim())
      setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
      setSelectedApproval(updated)
    } catch (err) {
      setError(toUserMessage(err, 'Reject action failed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <MobileLayout title="Approvals" subtitle={canApprove ? 'Decision inbox' : 'My requests'} primaryAction={{ label: 'Search', to: '/m/search' }}>
      {error ? <div className="m-alert m-alert-error">{error}</div> : null}

      <Section title="Decision Signals" subtitle="Where mobile approvals are stacking up right now.">
        <div className="m-stat-grid">
          <Card className="m-stat-card">
            <p>Pending</p>
            <strong>{stats.pending}</strong>
            <small>Requests waiting for a decision.</small>
          </Card>
          <Card className="m-stat-card">
            <p>Approved</p>
            <strong>{stats.approved}</strong>
            <small>Requests already cleared.</small>
          </Card>
          <Card className="m-stat-card">
            <p>Rejected</p>
            <strong>{stats.rejected}</strong>
            <small>Requests sent back with reasons.</small>
          </Card>
          <Card className="m-stat-card">
            <p>Visible</p>
            <strong>{filtered.length}</strong>
            <small>{canApprove ? 'Inbox items in current filter.' : 'Requests visible to this user.'}</small>
          </Card>
        </div>
      </Section>

      <SearchBar value={query} onChange={setQuery} placeholder="Search approvals" />
      <div className="m-chip-row">
        {STATUS_FILTERS.map((status) => (
          <Chip key={status} active={statusFilter === status} onClick={() => setStatusFilter(status)}>
            {titleCase(status)}
          </Chip>
        ))}
      </div>

      <Section title="Approval Queue" subtitle={`${filtered.length} items in ${titleCase(statusFilter)}`}>
        {loading ? <MobileListSkeleton rows={6} /> : null}
        {!loading && filtered.length === 0 ? (
          <MobileEmptyState
            title="No approvals"
            body="Nothing pending in this filter."
            action={<button type="button" className="m-link-btn" onClick={() => setStatusFilter('PENDING')}>Switch to pending</button>}
          />
        ) : null}

        <div className="m-list">
          {filtered.map((row) => (
            <button key={row.id} type="button" className="m-list-card" onClick={() => openDetail(row)}>
              <div className="m-list-top">
                <strong>{row.entity_summary || `${row.entity_type} #${row.entity_id}`}</strong>
                <span className={`m-status ${String(row.status || '').toLowerCase()}`}>{titleCase(row.status)}</span>
              </div>
              <p>{titleCase(row.approval_type || row.action_type)}</p>
              <div className="m-list-keyline">
                <span>{row.requested_by_name || row.requester_user_id}</span>
                <span>{formatDateTime(row.requested_at || row.created_at)}</span>
              </div>
            </button>
          ))}
        </div>
      </Section>

      <BottomSheet open={Boolean(selectedApproval)} title={`Approval #${selectedApproval?.id || ''}`} onClose={() => setSelectedApproval(null)}>
        {selectedApproval ? (
          <div className="m-sheet-stack">
            <Card className="m-sheet-card">
              <h4>Request Overview</h4>
              <KVRow label="Reference" value={selectedApproval.entity_summary || `${selectedApproval.entity_type} #${selectedApproval.entity_id}`} />
              <KVRow label="Type" value={titleCase(selectedApproval.approval_type || selectedApproval.action_type)} />
              <KVRow label="Status" value={titleCase(selectedApproval.status)} />
              <KVRow label="Requested" value={formatDateTime(selectedApproval.requested_at || selectedApproval.created_at)} />
            </Card>

            <Card className="m-note-card m-sheet-card">
              <strong>Reason</strong>
              <p>{selectedApproval.reason || 'No reason was supplied with this request.'}</p>
            </Card>

            {canApprove && selectedApproval.status === 'PENDING' ? (
              <div className="m-inline-actions">
                <button type="button" className="m-primary-btn" onClick={handleApprove} disabled={busy}>Approve</button>
                <button type="button" className="m-secondary-btn" onClick={handleReject} disabled={busy}>Reject</button>
              </div>
            ) : null}
          </div>
        ) : null}
      </BottomSheet>
    </MobileLayout>
  )
}
