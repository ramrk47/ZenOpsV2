import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import InfoTip from '../../components/ui/InfoTip'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import { fetchAssignments } from '../../api/assignments'
import { fetchTaskQueue } from '../../api/tasks'
import { fetchApprovalsInbox } from '../../api/approvals'
import { formatDateTime, titleCase } from '../../utils/format'
import { toUserMessage } from '../../api/client'

export default function AdminOpenQueue() {
  const [unassigned, setUnassigned] = useState([])
  const [blockedTasks, setBlockedTasks] = useState([])
  const [approvals, setApprovals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function loadQueue() {
      setLoading(true)
      setError(null)
      try {
        const [assignmentData, taskData, approvalData] = await Promise.all([
          fetchAssignments({ unassigned: true, completion: 'PENDING', sort_by: 'created_at', sort_dir: 'desc', limit: 80 }),
          fetchTaskQueue({ status: 'BLOCKED', limit: 80 }).catch(() => []),
          fetchApprovalsInbox(false).catch(() => []),
        ])
        if (cancelled) return
        setUnassigned(assignmentData)
        setBlockedTasks(taskData)
        setApprovals(approvalData)
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load open queue'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadQueue()
    return () => {
      cancelled = true
    }
  }, [])

  const stats = useMemo(() => ({
    unassigned: unassigned.length,
    blocked: blockedTasks.length,
    approvals: approvals.filter((a) => a.status === 'PENDING').length,
  }), [unassigned, blockedTasks, approvals])

  return (
    <div>
      <PageHeader
        title="Open Queue"
        subtitle="Unassigned work, blocked tasks, and pending approvals in one triage view."
        actions={<Badge tone={stats.unassigned + stats.blocked + stats.approvals > 0 ? 'warn' : 'ok'}>{stats.unassigned + stats.blocked + stats.approvals} open</Badge>}
      />

      {error ? <div className="empty" style={{ marginBottom: '0.8rem' }}>{error}</div> : null}

      <div className="grid cols-3" style={{ marginBottom: '0.9rem' }}>
        <Stat label="Unassigned Assignments" value={stats.unassigned} tone={stats.unassigned > 0 ? 'warn' : 'ok'} help="Assignments without a primary assignee." loading={loading} />
        <Stat label="Blocked Tasks" value={stats.blocked} tone={stats.blocked > 0 ? 'danger' : 'ok'} help="Tasks marked blocked that need escalation." loading={loading} />
        <Stat label="Approvals Pending" value={stats.approvals} tone={stats.approvals > 0 ? 'info' : 'ok'} help="Approvals waiting in your inbox." loading={loading} />
      </div>

      {loading ? (
        <div className="grid" style={{ gap: 16 }}>
          <Card>
            <CardHeader title="Unassigned Assignments" subtitle="Assignments without a primary or secondary assignee." />
            <ListSkeleton rows={4} />
          </Card>
          <Card>
            <CardHeader title="Blocked Tasks" subtitle="Tasks marked BLOCKED across assignments." />
            <ListSkeleton rows={4} />
          </Card>
          <Card>
            <CardHeader title="Approvals Pending" subtitle="Requests waiting for decisions." />
            <ListSkeleton rows={4} />
          </Card>
        </div>
      ) : (
        <div className="grid" style={{ gap: 16 }}>
          <Card>
            <CardHeader title="Unassigned Assignments" subtitle="Assignments without a primary or secondary assignee." action={<Link to="/assignments" className="nav-link">Open Assignments</Link>} />
            {unassigned.length === 0 ? (
              <EmptyState>No unassigned assignments right now.</EmptyState>
            ) : (
              <div className="list">
                {unassigned.map((assignment) => (
                  <Link key={assignment.id} to={`/assignments/${assignment.id}`} className="list-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <strong>{assignment.assignment_code}</strong>
                      <Badge tone="warn">Unassigned</Badge>
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      {assignment.borrower_name || 'No borrower'} · {assignment.bank_name || assignment.valuer_client_name || assignment.case_type}
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      Created {formatDateTime(assignment.created_at)}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Blocked Tasks" subtitle="Tasks marked BLOCKED across assignments." />
            {blockedTasks.length === 0 ? (
              <EmptyState>No blocked tasks right now.</EmptyState>
            ) : (
              <div className="list">
                {blockedTasks.map((task) => (
                  <Link key={task.id} to={`/assignments/${task.assignment_id}`} className="list-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <strong>{task.title}</strong>
                      <Badge tone="danger">Blocked</Badge>
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      {task.assignment_code || `Assignment #${task.assignment_id}`} · {task.borrower_name || 'Assignment'}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Approvals Pending" subtitle="Requests waiting for decisions." action={<Link to="/admin/approvals" className="nav-link">Open Inbox</Link>} />
            {approvals.length === 0 ? (
              <EmptyState>No approvals pending.</EmptyState>
            ) : (
              <div className="list">
                {approvals.map((approval) => (
                  <Link key={approval.id} to="/admin/approvals" className="list-item">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <strong>{titleCase(approval.action_type)}</strong>
                      <Badge tone="info">{titleCase(approval.status)}</Badge>
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      {titleCase(approval.entity_type)} #{approval.entity_id}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone, help, loading }) {
  return (
    <div className="card tight">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="kicker">{label}</div>
        {help ? <InfoTip text={help} /> : null}
      </div>
      {loading ? (
        <div className="skeleton-line" style={{ height: 18, marginTop: 8 }} />
      ) : (
        <div className="stat-value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
      )}
    </div>
  )
}

function ListSkeleton({ rows = 4 }) {
  return (
    <div className="list">
      {Array.from({ length: rows }).map((_, idx) => (
        <div key={`sk-${idx}`} className="list-item" style={{ display: 'grid', gap: 6 }}>
          <div className="skeleton-line" />
          <div className="skeleton-line short" />
        </div>
      ))}
    </div>
  )
}
