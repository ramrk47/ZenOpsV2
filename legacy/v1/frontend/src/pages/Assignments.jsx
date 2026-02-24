import React, { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  fetchAssignments,
  fetchAssignmentSummary,
  fetchAssignmentWorkload,
} from '../api/assignments'
import { fetchUserDirectory } from '../api/users'
import {
  fetchBanks,
  fetchBranches,
  fetchClients,
  fetchPropertyTypes,
} from '../api/master'
import PageHeader from '../components/ui/PageHeader'
import Badge from '../components/ui/Badge'
import { Card, CardHeader } from '../components/ui/Card'
import DataTable from '../components/ui/DataTable'
import KpiTile from '../components/ui/KpiTile'
import EmptyState from '../components/ui/EmptyState'
import { dueStateLabel, dueStateTone, formatDate, formatDateTime, formatMoney, titleCase } from '../utils/format'
import { loadJson, saveJson } from '../utils/storage'
import { useAuth } from '../auth/AuthContext'
import { canSeeAdmin } from '../utils/rbac'

const FILTERS_KEY = 'zenops.assignments.filters.v2'
const PREFS_KEY = 'zenops.assignments.prefs.v2'
const VIEWS_KEY = 'zenops.assignments.views.v1'

const SERVICE_LINES = ['VALUATION', 'INDUSTRIAL', 'DPR', 'CMA']

const defaultFilters = {
  search: '',
  status: '',
  case_type: '',
  service_line: '',
  bank_id: '',
  branch_id: '',
  client_id: '',
  property_type_id: '',
  due_state: '',
  assigned_to_user_id: '',
  created_by_user_id: '',
  completion: 'ALL',
  is_paid: '',
  mine: false,
  sort_by: 'created_at',
  sort_dir: 'desc',
}

export default function Assignments() {
  const [searchParams] = useSearchParams()
  const { user, capabilities } = useAuth()
  const [assignments, setAssignments] = useState([])
  const [summary, setSummary] = useState(null)
  const [workload, setWorkload] = useState([])
  const [users, setUsers] = useState([])
  const [banks, setBanks] = useState([])
  const [branches, setBranches] = useState([])
  const [clients, setClients] = useState([])
  const [propertyTypes, setPropertyTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)

  const [filters, setFilters] = useState(() => loadJson(FILTERS_KEY, defaultFilters))
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [prefs, setPrefs] = useState(() => loadJson(PREFS_KEY, { compact: false }))
  const [savedViews, setSavedViews] = useState(() => loadJson(VIEWS_KEY, []))
  const [activeViewId, setActiveViewId] = useState('')

  useEffect(() => {
    const params = Object.fromEntries(searchParams.entries())
    setFilters((prev) => {
      const next = { ...prev }
      let changed = false
      if (params.mine) {
        next.mine = params.mine === 'true'
        changed = true
      }
      if (params.completion) {
        next.completion = params.completion
        changed = true
      }
      if (params.status) {
        next.status = params.status
        changed = true
      }
      if (params.case_type) {
        next.case_type = params.case_type
        changed = true
      }
      if (params.service_line) {
        next.service_line = params.service_line
        changed = true
      }
      if (params.assigned_to_user_id) {
        next.assigned_to_user_id = params.assigned_to_user_id
        changed = true
      }
      if (params.bank_id) {
        next.bank_id = params.bank_id
        changed = true
      }
      if (params.branch_id) {
        next.branch_id = params.branch_id
        changed = true
      }
      if (params.client_id) {
        next.client_id = params.client_id
        changed = true
      }
      if (params.is_paid) {
        next.is_paid = params.is_paid
        changed = true
      }
      if (params.due) {
        next.due_state = params.due.toUpperCase() === 'OVERDUE' ? 'OVERDUE' : params.due.toUpperCase()
        changed = true
      }
      return changed ? next : prev
    })
  }, [searchParams])

  useEffect(() => {
    saveJson(FILTERS_KEY, filters)
  }, [filters])

  useEffect(() => {
    saveJson(PREFS_KEY, prefs)
  }, [prefs])

  useEffect(() => {
    saveJson(VIEWS_KEY, savedViews)
  }, [savedViews])

  useEffect(() => {
    let cancelled = false

    async function loadReferenceData() {
      try {
        const [userData, bankData, branchData, clientData, propData] = await Promise.all([
          fetchUserDirectory(),
          fetchBanks(),
          fetchBranches(),
          fetchClients(),
          fetchPropertyTypes(),
        ])
        if (cancelled) return
        setUsers(userData)
        setBanks(bankData)
        setBranches(branchData)
        setClients(clientData)
        setPropertyTypes(propData)
      } catch (err) {
        console.error(err)
      }
    }

    loadReferenceData()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!canSeeAdmin(capabilities)) return
    fetchAssignmentSummary().then(setSummary).catch((err) => console.error(err))
    fetchAssignmentWorkload().then(setWorkload).catch((err) => console.error(err))
  }, [user, capabilities])

  useEffect(() => {
    let cancelled = false

    async function loadAssignments() {
      setLoading(true)
      setError(null)
      try {
        const params = buildQueryParams(filters)
        const data = await fetchAssignments(params)
        if (cancelled) return
        setAssignments(data)
        if (data.length > 0 && !selected) {
          setSelected(data[0])
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) setError('Failed to load assignments')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadAssignments()

    return () => {
      cancelled = true
    }
  }, [filters])

  const filteredAssignments = useMemo(() => {
    const search = filters.search.trim().toLowerCase()
    let list = assignments
    if (filters.due_state) {
      list = list.filter((a) => a.due_state === filters.due_state)
    }
    if (!search) return list
    return list.filter((a) => {
      const haystack = [
        a.assignment_code,
        a.borrower_name,
        a.bank_name,
        a.branch_name,
        a.valuer_client_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(search)
    })
  }, [assignments, filters.search, filters.due_state])

  const userMap = useMemo(() => {
    const map = new Map()
    users.forEach((u) => map.set(u.id, u))
    return map
  }, [users])

  function updateFilter(name, value) {
    setFilters((prev) => ({ ...prev, [name]: value }))
  }

  function resetFilters() {
    setFilters(defaultFilters)
  }

  function applyQuickFilter(next) {
    setFilters((prev) => ({ ...prev, ...next }))
  }

  function handleApplyView(viewId) {
    if (!viewId) {
      setActiveViewId('')
      return
    }
    const view = savedViews.find((v) => v.id === viewId)
    if (!view) return
    setActiveViewId(viewId)
    setFilters({ ...defaultFilters, ...view.filters })
  }

  function handleSaveView() {
    const name = window.prompt('Save current view as:')
    if (!name) return
    const trimmed = name.trim()
    if (!trimmed) return
    const existing = savedViews.find((v) => v.name.toLowerCase() === trimmed.toLowerCase())
    const id = existing?.id || `view-${Date.now()}`
    const nextView = { id, name: trimmed, filters }
    setSavedViews((prev) => [...prev.filter((v) => v.id !== id), nextView])
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

  const stats = useMemo(() => {
    const overdue = filteredAssignments.filter((a) => a.due_state === 'OVERDUE').length
    const dueSoon = filteredAssignments.filter((a) => a.due_state === 'DUE_SOON').length
    const open = filteredAssignments.filter((a) => !['COMPLETED', 'CANCELLED'].includes(a.status)).length
    return { overdue, dueSoon, open, total: filteredAssignments.length }
  }, [filteredAssignments])

  const selectedTeamLabel = useMemo(() => {
    if (!selected) return ''
    const primary = userMap.get(selected.assigned_to_user_id)
    const additionalIds = selected.additional_assignee_user_ids || []
    const additionalCount = additionalIds.length
    const firstAdditional = additionalIds.length > 0 ? userMap.get(additionalIds[0]) : null
    const additionalSuffix = additionalCount > 1 ? ` (+${additionalCount - 1})` : ''
    if (primary) {
      return `${primary.full_name || primary.email}${additionalCount ? ` (+${additionalCount})` : ''}`
    }
    if (additionalCount > 0) {
      return `${firstAdditional?.full_name || firstAdditional?.email || 'Team'}${additionalSuffix}`
    }
    return 'Unassigned'
  }, [selected, userMap])

  return (
    <div>
      <PageHeader
        title="Assignments"
        subtitle="Filter, triage, and drive work to completion."
        actions={(
          <>
            <button
              type="button"
              className="secondary"
              onClick={() => setFilters({ ...defaultFilters, completion: 'PENDING', mine: false })}
            >
              Open Queue
            </button>
            <button type="button" className="secondary" onClick={() => setPrefs((p) => ({ ...p, compact: !p.compact }))}>
              {prefs.compact ? 'Comfortable' : 'Compact'}
            </button>
            <Link to="/assignments/new" className="nav-link">
              New Assignment
            </Link>
          </>
        )}
      />

      <div className="grid cols-4" style={{ marginBottom: '0.9rem' }}>
        <KpiTile
          label="Visible"
          value={stats.total}
          help="Assignments visible under current filters."
          onClick={() => applyQuickFilter({ completion: 'ALL', due_state: '' })}
        />
        <KpiTile
          label="Open"
          value={stats.open}
          help="Assignments not completed or cancelled."
          onClick={() => applyQuickFilter({ completion: 'PENDING', due_state: '' })}
        />
        <KpiTile
          label="Due Soon"
          value={stats.dueSoon}
          tone="warn"
          help="Due within the next 24 hours."
          onClick={() => applyQuickFilter({ completion: 'PENDING', due_state: 'DUE_SOON' })}
        />
        <KpiTile
          label="Overdue"
          value={stats.overdue}
          tone="danger"
          help="Past the computed due time."
          onClick={() => applyQuickFilter({ completion: 'PENDING', due_state: 'OVERDUE' })}
        />
      </div>

      {canSeeAdmin(capabilities) && summary ? (
        <div className="grid cols-4" style={{ marginBottom: '1rem' }}>
          <KpiTile label="Org Total" value={summary.total} help="Total assignments in the system." />
          <KpiTile label="Org Pending" value={summary.pending} help="Open assignments not completed or cancelled." />
          <KpiTile label="Org Unpaid" value={summary.unpaid} help="Assignments marked unpaid." />
          <KpiTile label="Org Overdue" value={summary.overdue} tone="danger" help="Assignments past SLA due time." />
        </div>
      ) : null}

      <div className="filter-shell">
        <div className="toolbar">
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
          <input
            className="grow"
            placeholder="Search by code, borrower, bank, client…"
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
          />

          <div className="chip-row">
            <button
              type="button"
              className={`chip ${filters.completion === 'PENDING' ? 'active' : ''}`.trim()}
              onClick={() => updateFilter('completion', filters.completion === 'PENDING' ? 'ALL' : 'PENDING')}
              aria-pressed={filters.completion === 'PENDING'}
            >
              Open
            </button>
            <button
              type="button"
              className={`chip ${filters.due_state === 'DUE_SOON' ? 'active' : ''}`.trim()}
              onClick={() => updateFilter('due_state', filters.due_state === 'DUE_SOON' ? '' : 'DUE_SOON')}
              aria-pressed={filters.due_state === 'DUE_SOON'}
            >
              Due soon
            </button>
            <button
              type="button"
              className={`chip ${filters.due_state === 'OVERDUE' ? 'active' : ''}`.trim()}
              onClick={() => updateFilter('due_state', filters.due_state === 'OVERDUE' ? '' : 'OVERDUE')}
              aria-pressed={filters.due_state === 'OVERDUE'}
            >
              Overdue
            </button>
            <button
              type="button"
              className={`chip ${filters.mine ? 'active' : ''}`.trim()}
              onClick={() => updateFilter('mine', !filters.mine)}
              aria-pressed={filters.mine}
            >
              Mine
            </button>
          </div>

          <button type="button" className="secondary" onClick={() => setFiltersOpen((open) => !open)}>
            {filtersOpen ? 'Hide Filters' : 'Filters'}
          </button>
          <button type="button" className="ghost" onClick={resetFilters}>
            Reset
          </button>
        </div>

        {filtersOpen ? (
          <div className="filter-panel">
            <div className="filter-grid">
              <select value={filters.status} onChange={(e) => updateFilter('status', e.target.value)}>
                <option value="">All Statuses</option>
                {['PENDING', 'SITE_VISIT', 'UNDER_PROCESS', 'SUBMITTED', 'COMPLETED', 'CANCELLED'].map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </select>

              <select value={filters.case_type} onChange={(e) => updateFilter('case_type', e.target.value)}>
                <option value="">All Case Types</option>
                {['BANK', 'EXTERNAL_VALUER', 'DIRECT_CLIENT'].map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </select>

              <select value={filters.service_line} onChange={(e) => updateFilter('service_line', e.target.value)}>
                <option value="">Service Line</option>
                {SERVICE_LINES.map((line) => (
                  <option key={line} value={line}>
                    {titleCase(line)}
                  </option>
                ))}
              </select>

              <select value={filters.assigned_to_user_id} onChange={(e) => updateFilter('assigned_to_user_id', e.target.value)}>
                <option value="">Assigned To</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name || u.email}
                  </option>
                ))}
              </select>

              <select value={filters.bank_id} onChange={(e) => updateFilter('bank_id', e.target.value)}>
                <option value="">Bank</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>

              <select value={filters.branch_id} onChange={(e) => updateFilter('branch_id', e.target.value)}>
                <option value="">Branch</option>
                {branches
                  .filter((br) => (filters.bank_id ? String(br.bank_id) === String(filters.bank_id) : true))
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>

              <select value={filters.property_type_id} onChange={(e) => updateFilter('property_type_id', e.target.value)}>
                <option value="">Property</option>
                {propertyTypes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>

              <select value={filters.completion} onChange={(e) => updateFilter('completion', e.target.value)}>
                <option value="ALL">All</option>
                <option value="PENDING">Open</option>
                <option value="COMPLETED">Completed</option>
              </select>

              <select value={filters.is_paid} onChange={(e) => updateFilter('is_paid', e.target.value)}>
                <option value="">Paid?</option>
                <option value="true">Paid</option>
                <option value="false">Unpaid</option>
              </select>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={filters.mine}
                  onChange={(e) => updateFilter('mine', e.target.checked)}
                />
                Mine
              </label>
            </div>
          </div>
        ) : null}
      </div>

      <div className="split">
        <Card>
          <CardHeader
            title="Work Queue"
            subtitle={`${filteredAssignments.length} assignments`}
            action={workload?.length ? <Badge tone="info">Workload ready</Badge> : null}
          />

          {loading ? (
            <DataTable loading columns={prefs.compact ? 6 : 8} rows={8} />
          ) : error ? (
            <EmptyState>{error}</EmptyState>
          ) : filteredAssignments.length === 0 ? (
            <EmptyState>No assignments match the current filters.</EmptyState>
          ) : (
            <DataTable>
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    {!prefs.compact ? <th>Borrower</th> : null}
                    <th>Status</th>
                    {!prefs.compact ? <th>Case</th> : null}
                    <th>Assigned</th>
                    <th>Due</th>
                    {!prefs.compact ? <th>Fees</th> : null}
                    {!prefs.compact ? <th>Dates</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {filteredAssignments.map((a) => {
                    const assignedUser = userMap.get(a.assigned_to_user_id)
                    const additionalIds = a.additional_assignee_user_ids || []
                    const additionalCount = additionalIds.length
                    const firstAdditional = additionalIds.length > 0 ? userMap.get(additionalIds[0]) : null
                    const additionalSuffix = additionalCount > 1 ? ` (+${additionalCount - 1})` : ''
                    const assignedLabel = assignedUser
                      ? `${assignedUser.full_name || assignedUser.email}${additionalCount ? ` (+${additionalCount})` : ''}`
                      : additionalCount > 0
                        ? `${firstAdditional?.full_name || firstAdditional?.email || 'Team'}${additionalSuffix}`
                        : 'Unassigned'
                    const isSelected = selected?.id === a.id
                    return (
                      <tr
                        key={a.id}
                        onClick={() => setSelected(a)}
                        onKeyDown={(event) => {
                          if (event.currentTarget !== event.target) return
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setSelected(a)
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        style={isSelected ? { outline: '2px solid rgba(91, 140, 255, 0.6)' } : undefined}
                      >
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <Link to={`/assignments/${a.id}`} onClick={(event) => event.stopPropagation()}>
                              <strong>{a.assignment_code}</strong>
                            </Link>
                            {!prefs.compact ? (
                              <span className="muted" style={{ fontSize: 12 }}>
                                {a.bank_name || a.valuer_client_name || a.case_type}
                              </span>
                            ) : null}
                            <HealthBadges
                              dueState={a.due_state}
                              missingCount={a.missing_documents_count}
                              isPaid={a.is_paid}
                              compact
                            />
                          </div>
                        </td>
                        {!prefs.compact ? <td>{a.borrower_name || '—'}</td> : null}
                        <td>
                          <Badge tone={a.status === 'COMPLETED' ? 'ok' : 'accent'}>{titleCase(a.status)}</Badge>
                        </td>
                        {!prefs.compact ? (
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span>{titleCase(a.case_type)}</span>
                              {a.service_line ? (
                                <span className="muted" style={{ fontSize: 12 }}>{titleCase(a.service_line)}</span>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                        <td>{assignedLabel}</td>
                        <td>
                          <Badge tone={dueStateTone(a.due_state)}>{dueStateLabel(a)}</Badge>
                        </td>
                        {!prefs.compact ? <td>{formatMoney(a.fees)}</td> : null}
                        {!prefs.compact ? (
                          <td>
                            <div className="muted" style={{ fontSize: 12 }}>
                              Created {formatDate(a.created_at)}
                            </div>
                            <div className="muted" style={{ fontSize: 12 }}>
                              Due {formatDateTime(a.due_time)}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </DataTable>
          )}
        </Card>

        <Card>
          <CardHeader title="Quick Preview" subtitle="Click a row to inspect details" />
          {!selected ? (
            <EmptyState>Select an assignment</EmptyState>
          ) : (
            <div className="grid" style={{ gap: 10 }}>
              <div>
                <div className="kicker">Assignment</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '1.1rem' }}>{selected.assignment_code}</strong>
                  <Badge tone={dueStateTone(selected.due_state)}>{dueStateLabel(selected)}</Badge>
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  {selected.bank_name || selected.valuer_client_name || titleCase(selected.case_type)}
                </div>
                <div style={{ marginTop: 6 }}>
                  <HealthBadges
                    dueState={selected.due_state}
                    missingCount={selected.missing_documents_count}
                    isPaid={selected.is_paid}
                  />
                </div>
              </div>

              <div className="grid cols-2">
                <PreviewField label="Borrower" value={selected.borrower_name || '—'} />
                <PreviewField label="Status" value={titleCase(selected.status)} />
                <PreviewField label="Service Line" value={selected.service_line ? titleCase(selected.service_line) : '—'} />
                <PreviewField label="Team" value={selectedTeamLabel} />
                <PreviewField label="Fees" value={formatMoney(selected.fees)} />
                <PreviewField label="Paid" value={selected.is_paid ? 'Yes' : 'No'} />
                <PreviewField label="Site Visit" value={formatDate(selected.site_visit_date)} />
                <PreviewField label="Report Due" value={formatDate(selected.report_due_date)} />
              </div>

              <div>
                <div className="kicker">Notes</div>
                <div className="list-item" style={{ marginTop: 6 }}>
                  {selected.notes || 'No notes yet.'}
                </div>
              </div>

              <div className="grid cols-2">
                <Link to={`/assignments/${selected.id}`} className="nav-link">
                  Open Workspace
                </Link>
                <Link to="/assignments/new" className="nav-link">
                  Duplicate Pattern
                </Link>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function buildQueryParams(filters) {
  const params = {
    completion: filters.completion,
    sort_by: filters.sort_by,
    sort_dir: filters.sort_dir,
    mine: filters.mine,
  }

  const numericKeys = [
    'bank_id',
    'branch_id',
    'client_id',
    'property_type_id',
    'assigned_to_user_id',
    'created_by_user_id',
  ]

  numericKeys.forEach((key) => {
    if (filters[key]) params[key] = Number(filters[key])
  })

  if (filters.status) params.status = filters.status
  if (filters.case_type) params.case_type = filters.case_type
  if (filters.service_line) params.service_line = filters.service_line
  if (filters.is_paid === 'true') params.is_paid = true
  if (filters.is_paid === 'false') params.is_paid = false

  return params
}

function PreviewField({ label, value }) {
  return (
    <div className="list-item">
      <div className="kicker">{label}</div>
      <div style={{ marginTop: 4 }}>{value}</div>
    </div>
  )
}

function HealthBadges({ dueState, missingCount = 0, isPaid, compact = false }) {
  const items = []
  if (missingCount > 0) {
    items.push({ label: `Missing Docs (${missingCount})`, tone: 'warn' })
  }
  if (dueState === 'OVERDUE') {
    items.push({ label: 'Overdue', tone: 'danger' })
  }
  if (isPaid === false) {
    items.push({ label: 'Payment Pending', tone: 'accent' })
  }
  if (items.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: compact ? 11 : 12 }}>
      {items.map((item) => (
        <Badge key={item.label} tone={item.tone}>{item.label}</Badge>
      ))}
    </div>
  )
}
