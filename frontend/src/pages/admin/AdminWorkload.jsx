import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import DataTable from '../../components/ui/DataTable'
import { fetchAssignmentWorkload, fetchAssignments, updateAssignment } from '../../api/assignments'
import { fetchCalendarEvents } from '../../api/calendar'
import { fetchUsers } from '../../api/users'
import { formatDate } from '../../utils/format'
import { toUserMessage } from '../../api/client'
import InfoTip from '../../components/ui/InfoTip'
import { useAuth } from '../../auth/AuthContext'
import { hasCapability } from '../../utils/rbac'
import { loadJson, saveJson } from '../../utils/storage'

const SORT_OPTIONS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'total_open', label: 'Total Open' },
  { key: 'due_soon', label: 'Due Soon' },
  { key: 'ok', label: 'On Track' },
]

const QUEUE_FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'OVERDUE', label: 'Overdue' },
  { key: 'DUE_SOON', label: 'Due Soon' },
  { key: 'ON_TRACK', label: 'On Track' },
  { key: 'UNASSIGNED', label: 'Unassigned' },
]

const VIEW_STORAGE_KEY = 'zenops.workload.views.v1'
const FILTERS_KEY = 'zenops.workload.filters.v1'

function capacityScore(row) {
  if (!row) return 0
  return (row.total_open || 0) + (row.overdue || 0) * 2 + (row.due_soon || 0)
}

function capacityTone(score) {
  if (score >= 8) return 'danger'
  if (score >= 5) return 'warn'
  return 'ok'
}

export default function AdminWorkload() {
  const { capabilities } = useAuth()
  const canReassign = hasCapability(capabilities, 'reassign')
  const [workload, setWorkload] = useState([])
  const [users, setUsers] = useState([])
  const [assignments, setAssignments] = useState([])
  const [leaveEvents, setLeaveEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const storedFilters = loadJson(FILTERS_KEY, {
    sortKey: 'overdue',
    showLeaveOnly: false,
    viewMode: 'table',
    queueFilter: 'ALL',
    assigneeFilter: 'ALL',
  })
  const [sortKey, setSortKey] = useState(storedFilters.sortKey || 'overdue')
  const [showLeaveOnly, setShowLeaveOnly] = useState(Boolean(storedFilters.showLeaveOnly))
  const [viewMode, setViewMode] = useState(storedFilters.viewMode || 'table')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [queueFilter, setQueueFilter] = useState(storedFilters.queueFilter || 'ALL')
  const [assigneeFilter, setAssigneeFilter] = useState(storedFilters.assigneeFilter || 'ALL')
  const [actionBusy, setActionBusy] = useState(false)
  const [autoAssignCount, setAutoAssignCount] = useState(3)
  const [rebalanceCount, setRebalanceCount] = useState(2)
  const [savedViews, setSavedViews] = useState(() => loadJson(VIEW_STORAGE_KEY, []))
  const [activeViewId, setActiveViewId] = useState('')

  useEffect(() => {
    saveJson(VIEW_STORAGE_KEY, savedViews)
  }, [savedViews])

  useEffect(() => {
    saveJson(FILTERS_KEY, {
      sortKey,
      showLeaveOnly,
      viewMode,
      queueFilter,
      assigneeFilter,
    })
  }, [sortKey, showLeaveOnly, viewMode, queueFilter, assigneeFilter])

  useEffect(() => {
    let cancelled = false

    async function loadData() {
      setLoading(true)
      setError(null)
      try {
        const today = new Date()
        const start = new Date(today)
        start.setDate(start.getDate() - 14)
        const end = new Date(today)
        end.setDate(end.getDate() + 30)

        const [workloadData, usersData, assignmentData] = await Promise.all([
          fetchAssignmentWorkload(),
          fetchUsers(),
          fetchAssignments({ completion: 'PENDING', sort_by: 'created_at', sort_dir: 'desc', limit: 250 }).catch(() => []),
        ])
        const leaveData = await fetchCalendarEvents({
          start_from: start.toISOString(),
          start_to: end.toISOString(),
          event_type: 'LEAVE',
        }).catch(() => [])
        if (cancelled) return
        setWorkload(workloadData)
        setUsers(usersData)
        setAssignments(assignmentData)
        setLeaveEvents(leaveData)
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load workload'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadData()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const userMap = useMemo(() => {
    const map = new Map()
    users.forEach((u) => map.set(u.id, u))
    return map
  }, [users])

  const leaveMap = useMemo(() => {
    const now = new Date()
    const perUser = new Map()
    leaveEvents.forEach((event) => {
      const userId = event.assigned_to_user_id || (event.assigned_user_ids || [])[0]
      if (!userId) return
      const start = new Date(event.start_at)
      const end = new Date(event.end_at)
      const entry = {
        start,
        end,
        label: `${formatDate(start)} → ${formatDate(end)}`,
        inRange: now >= start && now <= end,
      }
      const existing = perUser.get(String(userId))
      if (!existing) {
        perUser.set(String(userId), entry)
      } else if (existing.inRange && !entry.inRange) {
        return
      } else if (!existing.inRange && entry.inRange) {
        perUser.set(String(userId), entry)
      } else if (!existing.inRange && !entry.inRange) {
        if (entry.start < existing.start) perUser.set(String(userId), entry)
      }
    })
    return perUser
  }, [leaveEvents])

  const assignmentsByAssignee = useMemo(() => {
    const map = new Map()
    assignments.forEach((assignment) => {
      const key = assignment.assigned_to_user_id ? String(assignment.assigned_to_user_id) : 'unassigned'
      const list = map.get(key) || []
      list.push(assignment)
      map.set(key, list)
    })
    return map
  }, [assignments])

  const loadByUser = useMemo(() => {
    const map = new Map()
    workload.forEach((row) => {
      if (!row.user_id) return
      map.set(String(row.user_id), (row.total_open || 0) + (row.overdue || 0) * 2 + (row.due_soon || 0))
    })
    return map
  }, [workload])

  const activeAssignableUsers = useMemo(() => (
    users.filter((u) => {
      if (!u.is_active) return false
      const leaveInfo = leaveMap.get(String(u.id))
      return !leaveInfo?.inRange
    })
  ), [users, leaveMap])

  const leastLoadedUser = useMemo(() => {
    if (!activeAssignableUsers.length) return null
    return [...activeAssignableUsers]
      .sort((a, b) => {
        const aLoad = loadByUser.get(String(a.id)) || 0
        const bLoad = loadByUser.get(String(b.id)) || 0
        if (aLoad !== bLoad) return aLoad - bLoad
        return (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '')
      })[0]
  }, [activeAssignableUsers, loadByUser])

  function pickLeastLoadedUser(loadSnapshot, excludeId = null) {
    const pool = activeAssignableUsers.filter((user) => String(user.id) !== String(excludeId || ''))
    if (!pool.length) return null
    return [...pool]
      .sort((a, b) => {
        const aLoad = loadSnapshot.get(String(a.id)) || 0
        const bLoad = loadSnapshot.get(String(b.id)) || 0
        if (aLoad !== bLoad) return aLoad - bLoad
        return (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '')
      })[0]
  }

  function assignmentMatchesFilter(assignment) {
    if (queueFilter === 'ALL') return true
    if (queueFilter === 'UNASSIGNED') return !assignment.assigned_to_user_id
    if (queueFilter === 'OVERDUE') return assignment.due_state === 'OVERDUE'
    if (queueFilter === 'DUE_SOON') return assignment.due_state === 'DUE_SOON'
    if (queueFilter === 'ON_TRACK') return !assignment.due_state || assignment.due_state === 'OK'
    return true
  }

  function rowMatchesFilter(row) {
    if (queueFilter === 'ALL') return true
    if (queueFilter === 'UNASSIGNED') return !row.user_id
    if (queueFilter === 'OVERDUE') return (row.overdue || 0) > 0
    if (queueFilter === 'DUE_SOON') return (row.due_soon || 0) > 0
    if (queueFilter === 'ON_TRACK') return (row.ok || 0) > 0
    return true
  }

  const filteredUnassigned = useMemo(() => (
    (assignmentsByAssignee.get('unassigned') || []).filter(assignmentMatchesFilter)
  ), [assignmentsByAssignee, queueFilter])

  const sortedWorkload = useMemo(() => {
    const rows = workload
      .filter((w) => {
        if (showLeaveOnly && !(w.on_leave_today || (w.user_id && leaveMap.has(String(w.user_id))))) return false
        if (assigneeFilter === 'UNASSIGNED') return !w.user_id
        if (assigneeFilter !== 'ALL' && assigneeFilter !== 'UNASSIGNED') return String(w.user_id || '') === assigneeFilter
        return true
      })
      .filter(rowMatchesFilter)

    const sorted = [...rows].sort((a, b) => {
      if ((b[sortKey] ?? 0) !== (a[sortKey] ?? 0)) return (b[sortKey] ?? 0) - (a[sortKey] ?? 0)
      return (b.total_open ?? 0) - (a.total_open ?? 0)
    })
    return sorted
  }, [workload, sortKey, showLeaveOnly, leaveMap, queueFilter, assigneeFilter])

  const stats = useMemo(() => {
    const totalOpen = workload.reduce((sum, row) => sum + (row.total_open || 0), 0)
    const overdue = workload.reduce((sum, row) => sum + (row.overdue || 0), 0)
    const dueSoon = workload.reduce((sum, row) => sum + (row.due_soon || 0), 0)
    const onLeave = workload.filter((row) => row.on_leave_today).length
    return { totalOpen, overdue, dueSoon, onLeave }
  }, [workload])

  function handleApplyView(viewId) {
    if (!viewId) {
      setActiveViewId('')
      return
    }
    const view = savedViews.find((v) => v.id === viewId)
    if (!view) return
    setActiveViewId(viewId)
    setSortKey(view.sortKey || 'overdue')
    setShowLeaveOnly(Boolean(view.showLeaveOnly))
    setViewMode(view.viewMode || 'table')
    setQueueFilter(view.queueFilter || 'ALL')
    setAssigneeFilter(view.assigneeFilter || 'ALL')
    setAutoAssignCount(Number(view.autoAssignCount || 3))
    setRebalanceCount(Number(view.rebalanceCount || 2))
  }

  function handleSaveView() {
    const name = window.prompt('Save current view as:')
    if (!name) return
    const trimmed = name.trim()
    if (!trimmed) return
    const existing = savedViews.find((v) => v.name.toLowerCase() === trimmed.toLowerCase())
    const id = existing?.id || `view-${Date.now()}`
    const payload = {
      id,
      name: trimmed,
      sortKey,
      showLeaveOnly,
      viewMode,
      queueFilter,
      assigneeFilter,
      autoAssignCount,
      rebalanceCount,
    }
    setSavedViews((prev) => [...prev.filter((v) => v.id !== id), payload])
    setActiveViewId(id)
  }

  function handleDeleteView() {
    if (!activeViewId) return
    const view = savedViews.find((v) => v.id === activeViewId)
    const label = view?.name || 'this view'
    if (!window.confirm(`Delete ${label}?`)) return
    setSavedViews((prev) => prev.filter((v) => v.id !== activeViewId))
    setActiveViewId('')
  }

  async function handleReassign(assignment, nextUserId) {
    if (!canReassign) return false
    setError(null)
    setNotice(null)
    const assignedTo = nextUserId ? Number(nextUserId) : null
    try {
      const updated = await updateAssignment(assignment.id, { assigned_to_user_id: assignedTo })
      setAssignments((prev) => prev.map((a) => (a.id === assignment.id ? { ...a, ...updated } : a)))
      const workloadData = await fetchAssignmentWorkload().catch(() => null)
      if (workloadData) setWorkload(workloadData)
      return true
    } catch (err) {
      const detail = err?.response?.data?.detail
      if (err?.response?.status === 409 && detail?.message) {
        const confirmOverride = window.confirm(`${detail.message}. Override leave and assign anyway?`)
        if (!confirmOverride) return false
        try {
          const updated = await updateAssignment(assignment.id, { assigned_to_user_id: assignedTo, override_on_leave: true })
          setAssignments((prev) => prev.map((a) => (a.id === assignment.id ? { ...a, ...updated } : a)))
          const workloadData = await fetchAssignmentWorkload().catch(() => null)
          if (workloadData) setWorkload(workloadData)
          return true
        } catch (overrideErr) {
          console.error(overrideErr)
          setError(toUserMessage(overrideErr, 'Failed to reassign assignment'))
          return false
        }
      }
      console.error(err)
      setError(toUserMessage(err, 'Failed to reassign assignment'))
      return false
    }
  }

  async function handleAutoAssignBatch(count) {
    if (!canReassign || actionBusy) return
    setError(null)
    setNotice(null)
    if (!activeAssignableUsers.length) {
      setNotice('No active assignee available (everyone is inactive or on leave).')
      return
    }
    const candidates = filteredUnassigned.slice(0, count)
    if (!candidates.length) {
      setNotice('No unassigned assignment available for the current filter.')
      return
    }
    const loadSnapshot = new Map(loadByUser)
    setActionBusy(true)
    let assigned = 0
    for (const assignment of candidates) {
      const target = pickLeastLoadedUser(loadSnapshot)
      if (!target) break
      const ok = await handleReassign(assignment, target.id)
      if (ok) {
        assigned += 1
        loadSnapshot.set(String(target.id), (loadSnapshot.get(String(target.id)) || 0) + 1)
      }
    }
    if (assigned) {
      setNotice(`Auto-assigned ${assigned} assignment${assigned === 1 ? '' : 's'} to the least-loaded assignee.`)
    } else {
      setNotice('No assignment could be auto-assigned right now.')
    }
    setActionBusy(false)
  }

  async function handleRebalanceBatch(count) {
    if (!canReassign || actionBusy) return
    setError(null)
    setNotice(null)
    const overdueAssignments = assignments
      .filter((assignment) => assignment.due_state === 'OVERDUE' && assignment.assigned_to_user_id)
      .sort((a, b) => {
        const aLoad = loadByUser.get(String(a.assigned_to_user_id || '')) || 0
        const bLoad = loadByUser.get(String(b.assigned_to_user_id || '')) || 0
        if (aLoad !== bLoad) return bLoad - aLoad
        return new Date(a.created_at || 0) - new Date(b.created_at || 0)
      })

    if (!overdueAssignments.length) {
      setNotice('No overdue assignments available for rebalancing.')
      return
    }

    const loadSnapshot = new Map(loadByUser)
    let rebalanced = 0
    setActionBusy(true)
    for (const assignment of overdueAssignments) {
      if (rebalanced >= count) break
      const leaveInfo = leaveMap.get(String(assignment.assigned_to_user_id))
      if (leaveInfo?.inRange) continue
      const target = pickLeastLoadedUser(loadSnapshot, assignment.assigned_to_user_id)
      if (!target) continue
      const ok = await handleReassign(assignment, target.id)
      if (ok) {
        rebalanced += 1
        const currentLoad = loadSnapshot.get(String(target.id)) || 0
        loadSnapshot.set(String(target.id), currentLoad + 1)
        if (assignment.assigned_to_user_id) {
          const fromId = String(assignment.assigned_to_user_id)
          const fromLoad = loadSnapshot.get(fromId) || 0
          loadSnapshot.set(fromId, Math.max(0, fromLoad - 1))
        }
      }
    }

    if (rebalanced) {
      setNotice(`Rebalanced ${rebalanced} overdue assignment${rebalanced === 1 ? '' : 's'} to lower-load assignees.`)
    } else {
      setNotice('No overdue assignment could be rebalanced right now.')
    }
    setActionBusy(false)
  }

  async function handleAutoAssignUnassigned() {
    await handleAutoAssignBatch(1)
  }

  async function handleRebalanceOneOverdue() {
    await handleRebalanceBatch(1)
  }

  return (
    <div>
      <PageHeader
        title="Workload Board"
        subtitle="Balance assignments around SLA pressure and leave visibility."
        actions={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge tone={stats.overdue > 0 ? 'danger' : 'ok'}>{stats.overdue} overdue</Badge>
            <button type="button" className="secondary" onClick={() => setSortKey('overdue')}>Reset Sort</button>
          </div>
        )}
      />

      {error ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{error}</div> : null}
      {notice ? <div className="notice" style={{ marginBottom: '0.9rem' }}>{notice}</div> : null}

      <div className="grid cols-4" style={{ marginBottom: '0.9rem' }}>
        <Stat label="Total Open" value={stats.totalOpen} help="Open assignments across all assignees." />
        <Stat label="Overdue" value={stats.overdue} tone="danger" help="Assignments past the computed due time." />
        <Stat label="Due Soon" value={stats.dueSoon} tone="warn" help="Assignments due within 24 hours." />
        <Stat label="On Leave" value={stats.onLeave} tone="info" help="People currently on approved leave." />
      </div>

      <Card>
        <CardHeader
          title="Queue Pressure"
          subtitle={showLeaveOnly ? 'Showing people on leave today' : 'All active assignees'}
          action={(
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Badge tone={queueFilter === 'OVERDUE' ? 'danger' : 'info'}>{sortedWorkload.length} rows</Badge>
              <button type="button" className="secondary" onClick={() => setReloadKey((k) => k + 1)}>Refresh</button>
            </div>
          )}
        />

        <div className="filter-shell">
          <div className="toolbar dense">
            <select value={activeViewId} onChange={(e) => handleApplyView(e.target.value)}>
              <option value="">Saved views</option>
              {savedViews.map((view) => (
                <option key={view.id} value={view.id}>{view.name}</option>
              ))}
            </select>
            <button type="button" className="ghost" onClick={handleSaveView}>Save View</button>
            {activeViewId ? (
              <button type="button" className="ghost" onClick={handleDeleteView}>Delete View</button>
            ) : null}
            <div className="chip-row">
              {QUEUE_FILTERS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`chip ${queueFilter === opt.key ? 'active' : ''}`.trim()}
                  onClick={() => setQueueFilter(opt.key)}
                  aria-pressed={queueFilter === opt.key}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button type="button" className="secondary" onClick={() => setFiltersOpen((open) => !open)}>
              {filtersOpen ? 'Hide Filters' : 'Filters'}
            </button>
            <Badge tone="info">{sortedWorkload.length} shown</Badge>
          </div>

          {filtersOpen ? (
            <div className="filter-panel">
              <div className="filter-grid">
                <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
                  <option value="ALL">All Assignees</option>
                  <option value="UNASSIGNED">Unassigned</option>
                  {users.filter((u) => u.is_active).map((u) => (
                    <option key={u.id} value={String(u.id)}>{u.full_name || u.email}</option>
                  ))}
                </select>
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                  {SORT_OPTIONS.map((opt) => (
                    <option key={opt.key} value={opt.key}>{opt.label}</option>
                  ))}
                </select>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className={viewMode === 'table' ? 'secondary' : 'ghost'} onClick={() => setViewMode('table')}>
                    Table
                  </button>
                  <button type="button" className={viewMode === 'board' ? 'secondary' : 'ghost'} onClick={() => setViewMode('board')}>
                    Board
                  </button>
                </div>
              </div>
              <div className="toolbar dense" style={{ marginTop: '0.6rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={showLeaveOnly} onChange={(e) => setShowLeaveOnly(e.target.checked)} />
                  <span className="kicker" style={{ marginTop: 2 }}>Leave only</span>
                </label>
              </div>
              {canReassign ? (
                <div className="toolbar dense" style={{ marginTop: '0.6rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="kicker" style={{ marginTop: 2 }}>Auto</span>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={autoAssignCount}
                      onChange={(e) => setAutoAssignCount(Number(e.target.value) || 1)}
                      style={{ width: 64 }}
                    />
                  </label>
                  <button type="button" className="secondary" onClick={() => handleAutoAssignBatch(autoAssignCount)} disabled={actionBusy}>
                    Auto Assign
                  </button>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="kicker" style={{ marginTop: 2 }}>Rebalance</span>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={rebalanceCount}
                      onChange={(e) => setRebalanceCount(Number(e.target.value) || 1)}
                      style={{ width: 64 }}
                    />
                  </label>
                  <button type="button" className="ghost" onClick={() => handleRebalanceBatch(rebalanceCount)} disabled={actionBusy}>
                    Rebalance Overdue
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {loading ? (
          viewMode === 'table' ? <DataTable loading columns={8} rows={6} /> : <div className="muted">Loading workload…</div>
        ) : viewMode === 'board' ? (
          <div className="workload-board">
            {[...users, { id: null, full_name: 'Unassigned', email: '', role: '—' }]
              .filter((u) => {
                if (showLeaveOnly && !(u.id && leaveMap.has(String(u.id)))) return false
                if (assigneeFilter === 'UNASSIGNED') return !u.id
                if (assigneeFilter !== 'ALL' && assigneeFilter !== 'UNASSIGNED') return String(u.id || '') === assigneeFilter
                return true
              })
              .map((user) => {
                const key = user.id ? String(user.id) : 'unassigned'
                const list = (assignmentsByAssignee.get(key) || []).filter(assignmentMatchesFilter)
                if (list.length === 0 && (showLeaveOnly || queueFilter !== 'ALL' || assigneeFilter !== 'ALL')) return null
                const leaveInfo = user.id ? leaveMap.get(String(user.id)) : null
                const workloadRow = user.id ? workload.find((row) => row.user_id === user.id) : null
                const capScore = capacityScore(workloadRow)
                const capTone = capacityTone(capScore)
                const leaveLabel = leaveInfo
                  ? leaveInfo.inRange
                    ? `On Leave ${leaveInfo.label}`
                    : `Upcoming Leave ${leaveInfo.label}`
                  : null
                return (
                  <div key={key} className="workload-column">
                    <div className="workload-column-header">
                      <strong>{user.full_name || user.email || 'Unassigned'}</strong>
                      {user.id ? <Badge tone={capTone}>Capacity {capScore}</Badge> : null}
                      {leaveLabel ? <Badge tone="warn">{leaveLabel}</Badge> : null}
                      <span className="muted" style={{ fontSize: 12 }}>{list.length} items</span>
                    </div>
                    <div className="workload-cards">
                      {list.length === 0 ? (
                        <div className="muted" style={{ fontSize: 12 }}>No assignments</div>
                      ) : list.map((assignment) => (
                        <div key={assignment.id} className="workload-card">
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                            <strong>{assignment.assignment_code}</strong>
                            <Badge tone={assignment.due_state === 'OVERDUE' ? 'danger' : assignment.due_state === 'DUE_SOON' ? 'warn' : 'ok'}>
                              {assignment.due_state || 'OK'}
                            </Badge>
                          </div>
                          <div className="muted" style={{ marginTop: 4 }}>
                            {assignment.borrower_name || 'Borrower'} · {assignment.bank_name || assignment.valuer_client_name || assignment.case_type}
                          </div>
                          <Link to={`/assignments/${assignment.id}`} className="nav-link" style={{ marginTop: 6, display: 'inline-block' }}>
                            Open
                          </Link>
                          {canReassign ? (
                            <div style={{ marginTop: 8 }}>
                              <select
                                value={assignment.assigned_to_user_id || ''}
                                onChange={(e) => handleReassign(assignment, e.target.value)}
                              >
                                <option value="">Unassigned</option>
                                {users.filter((u) => u.is_active).map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.full_name || u.email}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
          </div>
        ) : sortedWorkload.length === 0 ? (
          <EmptyState>No workload data is available.</EmptyState>
        ) : (
          <DataTable>
            <table>
              <thead>
                <tr>
                  <th>Assignee</th>
                  <th>Open</th>
                  <th>Overdue</th>
                  <th>Due Soon</th>
                  <th>On Track</th>
                  <th>Capacity</th>
                  <th>Buckets</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedWorkload.map((row) => {
                  const user = row.user_id ? userMap.get(row.user_id) : null
                  const displayName = row.user_name || user?.full_name || row.user_email || 'Unassigned'
                  const tone = row.overdue > 0 ? 'danger' : row.due_soon > 0 ? 'warn' : 'ok'
                  const rowKey = row.user_id ?? row.user_email ?? `unassigned-${row.total_open}-${row.overdue}-${row.due_soon}`
                  const leaveInfo = row.user_id ? leaveMap.get(String(row.user_id)) : null
                  const leaveLabel = leaveInfo
                    ? leaveInfo.inRange
                      ? `On Leave ${leaveInfo.label}`
                      : `Upcoming Leave ${leaveInfo.label}`
                    : null
                  const capScore = capacityScore(row)
                  const capTone = capacityTone(capScore)
                  return (
                    <tr key={rowKey}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <strong>{displayName}</strong>
                          <span className="muted" style={{ fontSize: 12 }}>{row.user_email || user?.email}</span>
                          {leaveLabel ? <span className="muted" style={{ fontSize: 12 }}>{leaveLabel}</span> : null}
                        </div>
                      </td>
                      <td>{row.total_open}</td>
                      <td>{row.overdue}</td>
                      <td>{row.due_soon}</td>
                      <td>{row.ok}</td>
                      <td><Badge tone={capTone}>{capScore}</Badge></td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {(row.buckets || []).map((bucket) => (
                            <Badge key={bucket.due_state} tone={bucket.due_state === 'OVERDUE' ? 'danger' : bucket.due_state === 'DUE_SOON' ? 'warn' : 'ok'}>
                              {bucket.due_state}: {bucket.count}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td>
                        {row.on_leave_today ? <Badge tone="warn">On Leave</Badge> : <Badge tone={tone}>Available</Badge>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </DataTable>
        )}
      </Card>
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
