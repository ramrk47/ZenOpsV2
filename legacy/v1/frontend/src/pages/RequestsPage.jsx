import React, { useEffect, useMemo, useState } from 'react'
import PageHeader from '../components/ui/PageHeader'
import Badge from '../components/ui/Badge'
import { Card, CardHeader } from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import InfoTip from '../components/ui/InfoTip'
import { fetchMyLeave, requestLeave } from '../api/leave'
import { fetchMyApprovals, requestApproval, fetchApprovalTemplates } from '../api/approvals'
import { fetchAssignments } from '../api/assignments'
import { formatDate, formatDateTime, titleCase } from '../utils/format'
import { toUserMessage } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { canSeeAdmin } from '../utils/rbac'

const LEAVE_TYPES = ['FULL_DAY', 'HALF_DAY', 'PERMISSION_HOURS']
const DEFAULT_APPROVAL_ACTIONS = [
  'DOC_REQUEST',
  'FIELD_VISIT',
  'FINAL_REVIEW',
  'CLIENT_CALL',
  'PAYMENT_FOLLOWUP',
  'FEE_OVERRIDE',
  'REASSIGN',
  'CLOSE_ASSIGNMENT',
  'MARK_PAID',
  'EXCEPTION',
]

export default function RequestsPage() {
  const { capabilities } = useAuth()
  const [leaves, setLeaves] = useState([])
  const [approvals, setApprovals] = useState([])
  const [assignments, setAssignments] = useState([])
  const [approvalTemplates, setApprovalTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [leaveForm, setLeaveForm] = useState({
    leave_type: 'FULL_DAY',
    start_date: '',
    end_date: '',
    hours: '',
    reason: '',
  })

  const [approvalForm, setApprovalForm] = useState({
    assignment_id: '',
    action_type: 'DOC_REQUEST',
    reason: '',
  })

  const isPermissionHours = leaveForm.leave_type === 'PERMISSION_HOURS'

  useEffect(() => {
    let cancelled = false

    async function loadData() {
      setLoading(true)
      setError(null)
      try {
        const viewOrg = canSeeAdmin(capabilities)
        const [leaveData, approvalData, assignmentData, templates] = await Promise.all([
          fetchMyLeave(),
          fetchMyApprovals(true),
          fetchAssignments({ mine: !viewOrg, completion: 'ALL', sort_by: 'created_at', sort_dir: 'desc', limit: 200 }).catch(() => []),
          fetchApprovalTemplates().catch(() => []),
        ])
        if (cancelled) return
        setLeaves(leaveData)
        setApprovals(approvalData)
        setAssignments(assignmentData)
        setApprovalTemplates(templates)
        if (assignmentData[0]) {
          setApprovalForm((prev) => {
            if (prev.assignment_id) return prev
            return { ...prev, assignment_id: String(assignmentData[0].id) }
          })
        }
        if (templates[0]) {
          setApprovalForm((prev) => {
            if (prev.action_type) return prev
            return { ...prev, action_type: templates[0].action_type }
          })
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load requests'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadData()
    return () => {
      cancelled = true
    }
  }, [reloadKey, capabilities])

  const stats = useMemo(() => {
    const pendingLeave = leaves.filter((l) => l.status === 'PENDING').length
    const pendingApprovals = approvals.filter((a) => a.status === 'PENDING').length
    const approvedLeave = leaves.filter((l) => l.status === 'APPROVED').length
    const rejected = leaves.filter((l) => l.status === 'REJECTED').length + approvals.filter((a) => a.status === 'REJECTED').length
    return { pendingLeave, pendingApprovals, approvedLeave, rejected }
  }, [leaves, approvals])

  const approvalActions = useMemo(() => {
    const source = approvalTemplates.length > 0
      ? approvalTemplates.map((template) => template.action_type).filter(Boolean)
      : DEFAULT_APPROVAL_ACTIONS
    const seen = new Set()
    return source.filter((action) => {
      if (!action || seen.has(action)) return false
      seen.add(action)
      return true
    })
  }, [approvalTemplates])

  const selectedTemplate = useMemo(
    () => approvalTemplates.find((t) => t.action_type === approvalForm.action_type),
    [approvalTemplates, approvalForm.action_type],
  )

  function updateLeaveForm(key, value) {
    setLeaveForm((prev) => ({ ...prev, [key]: value }))
  }

  function updateApprovalForm(key, value) {
    setApprovalForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleRequestLeave(e) {
    e.preventDefault()
    setError(null)
    setNotice(null)

    if (!leaveForm.start_date) {
      setError('Start date is required.')
      return
    }

    if (!isPermissionHours && !leaveForm.end_date) {
      setError('End date is required.')
      return
    }

    if (isPermissionHours && !leaveForm.hours) {
      setError('Hours are required for permission requests.')
      return
    }

    try {
      await requestLeave({
        leave_type: leaveForm.leave_type,
        start_date: leaveForm.start_date,
        end_date: isPermissionHours ? leaveForm.start_date : leaveForm.end_date,
        hours: isPermissionHours ? Number(leaveForm.hours) : null,
        reason: leaveForm.reason.trim() || null,
      })
      setNotice('Leave request submitted.')
      setLeaveForm({ leave_type: leaveForm.leave_type, start_date: '', end_date: '', hours: '', reason: '' })
      setReloadKey((k) => k + 1)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to request leave'))
    }
  }

  async function handleRequestApproval(e) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    try {
      if (!approvalForm.assignment_id) {
        setError('Select an assignment for the approval request.')
        return
      }
      await requestApproval({
        entity_type: 'ASSIGNMENT',
        entity_id: Number(approvalForm.assignment_id),
        action_type: approvalForm.action_type,
        reason: approvalForm.reason.trim() || null,
        assignment_id: Number(approvalForm.assignment_id),
      })
      setNotice('Approval request submitted.')
      setApprovalForm((prev) => ({ ...prev, reason: '' }))
      setReloadKey((k) => k + 1)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to request approval'))
    }
  }

  return (
    <div>
      <PageHeader
        title="Requests"
        subtitle="Submit leave and track approval requests without hunting through admin screens."
        actions={<Badge tone={stats.pendingLeave + stats.pendingApprovals > 0 ? 'warn' : 'ok'}>{stats.pendingLeave + stats.pendingApprovals} pending</Badge>}
      />

      {error ? <div className="empty" style={{ marginBottom: '0.8rem' }}>{error}</div> : null}
      {notice ? <div className="card notice tight" style={{ marginBottom: '0.8rem' }}>{notice}</div> : null}

      <div className="grid cols-4" style={{ marginBottom: '0.9rem' }}>
        <Stat label="Leave Pending" value={stats.pendingLeave} tone={stats.pendingLeave > 0 ? 'warn' : undefined} help="Leave requests waiting for approval." />
        <Stat label="Approvals Pending" value={stats.pendingApprovals} tone={stats.pendingApprovals > 0 ? 'info' : undefined} help="Approvals you requested that are still pending." />
        <Stat label="Leave Approved" value={stats.approvedLeave} tone="ok" help="Approved leave requests." />
        <Stat label="Rejected" value={stats.rejected} tone={stats.rejected > 0 ? 'danger' : undefined} help="Rejected leave or approval requests." />
      </div>

      <div className="split">
        <div className="grid">
          <Card>
            <CardHeader title="My Leave" subtitle="All leave requests and their decisions." action={<button type="button" className="secondary" onClick={() => setReloadKey((k) => k + 1)}>Refresh</button>} />
            {loading ? (
              <div className="muted">Loading leave…</div>
            ) : leaves.length === 0 ? (
              <EmptyState>No leave requests yet.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Dates</th>
                      <th>Hours</th>
                      <th>Status</th>
                      <th>Reason</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaves.map((leave) => {
                      const tone = leave.status === 'APPROVED' ? 'ok' : leave.status === 'REJECTED' ? 'danger' : 'warn'
                      const dateLabel = leave.leave_type === 'PERMISSION_HOURS'
                        ? formatDate(leave.start_date)
                        : `${formatDate(leave.start_date)} → ${formatDate(leave.end_date || leave.start_date)}`
                      return (
                        <tr key={leave.id}>
                          <td>{titleCase(leave.leave_type)}</td>
                          <td>{dateLabel}</td>
                          <td>{leave.hours ?? '—'}</td>
                          <td><Badge tone={tone}>{titleCase(leave.status)}</Badge></td>
                          <td>{leave.reason || '—'}</td>
                          <td>{formatDateTime(leave.created_at)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="My Approval Requests" subtitle="Track approvals you have asked for across the system." />
            {loading ? (
              <div className="muted">Loading approvals…</div>
            ) : approvals.length === 0 ? (
              <EmptyState>No approval requests yet.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Entity</th>
                      <th>Status</th>
                      <th>Reason</th>
                      <th>Created</th>
                      <th>Decided</th>
                    </tr>
                  </thead>
                  <tbody>
                    {approvals.map((approval) => {
                      const tone = approval.status === 'APPROVED' ? 'ok' : approval.status === 'REJECTED' ? 'danger' : 'warn'
                      return (
                        <tr key={approval.id}>
                          <td>{titleCase(approval.action_type)}</td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span>{titleCase(approval.entity_type)} #{approval.entity_id}</span>
                              {approval.assignment_id ? <span className="muted" style={{ fontSize: 12 }}>Assignment #{approval.assignment_id}</span> : null}
                            </div>
                          </td>
                          <td><Badge tone={tone}>{titleCase(approval.status)}</Badge></td>
                          <td>{approval.reason || '—'}</td>
                          <td>{formatDateTime(approval.created_at)}</td>
                          <td>{approval.decided_at ? formatDateTime(approval.decided_at) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="grid">
          <Card>
            <CardHeader title="Request Leave" subtitle="Leave drives calendar overlays and workload signals." />
            <form className="grid" onSubmit={handleRequestLeave}>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Leave Type</span>
                <select value={leaveForm.leave_type} onChange={(e) => updateLeaveForm('leave_type', e.target.value)}>
                  {LEAVE_TYPES.map((type) => (
                    <option key={type} value={type}>{titleCase(type)}</option>
                  ))}
                </select>
              </label>

              <div className="grid cols-2 tight-cols">
                <label className="grid" style={{ gap: 6 }}>
                  <span className="kicker">Start Date</span>
                  <input type="date" value={leaveForm.start_date} onChange={(e) => updateLeaveForm('start_date', e.target.value)} required />
                </label>
                {!isPermissionHours ? (
                  <label className="grid" style={{ gap: 6 }}>
                    <span className="kicker">End Date</span>
                    <input type="date" value={leaveForm.end_date} onChange={(e) => updateLeaveForm('end_date', e.target.value)} required />
                  </label>
                ) : (
                  <label className="grid" style={{ gap: 6 }}>
                    <span className="kicker">Hours</span>
                    <input type="number" min="0.5" step="0.5" value={leaveForm.hours} onChange={(e) => updateLeaveForm('hours', e.target.value)} required />
                  </label>
                )}
              </div>

              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Reason</span>
                <textarea rows={4} value={leaveForm.reason} onChange={(e) => updateLeaveForm('reason', e.target.value)} placeholder="Optional context for approvers." />
              </label>

              <button type="submit">Submit Leave Request</button>
              <div className="muted" style={{ fontSize: 12 }}>
                Approved leave automatically appears on calendar and affects workload views.
              </div>
            </form>
          </Card>

          <Card>
            <CardHeader title="Request Approval" subtitle="Ask for sensitive actions without admin-only screens." />
            <form className="grid" onSubmit={handleRequestApproval}>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Assignment</span>
                <select value={approvalForm.assignment_id} onChange={(e) => updateApprovalForm('assignment_id', e.target.value)}>
                  <option value="">Select assignment</option>
                  {assignments.map((assignment) => (
                    <option key={assignment.id} value={assignment.id}>
                      {assignment.assignment_code} · {assignment.borrower_name || assignment.bank_name || 'Assignment'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Action</span>
                <select value={approvalForm.action_type} onChange={(e) => updateApprovalForm('action_type', e.target.value)}>
                  {approvalActions.map((action) => (
                    <option key={action} value={action}>{titleCase(action)}</option>
                  ))}
                </select>
                {selectedTemplate?.description ? (
                  <span className="muted" style={{ fontSize: 12 }}>{selectedTemplate.description}</span>
                ) : null}
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="kicker">Reason</span>
                <textarea rows={3} value={approvalForm.reason} onChange={(e) => updateApprovalForm('reason', e.target.value)} />
              </label>
              <button type="submit">Submit Approval Request</button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, tone, help }) {
  return (
    <div className="card tight">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="kicker">{label}</div>
        {help ? <InfoTip text={help} /> : null}
      </div>
      <div className="stat-value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
    </div>
  )
}
