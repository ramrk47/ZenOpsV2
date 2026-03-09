import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import MobileLayout from '../MobileLayout'
import { Card, Chip, MobileEmptyState, MobileListSkeleton, SearchBar, Section } from '../components/Primitives'
import { fetchAssignments } from '../../api/assignments'
import { fetchMobileSummary } from '../../api/mobile'
import { formatDateTime, titleCase } from '../../utils/format'
import { toUserMessage } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { isPartner } from '../../utils/rbac'
import DemoInlineHelp from '../../demo/tutorial/DemoInlineHelp.jsx'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'active', label: 'Active' },
  { key: 'pending_approval', label: 'Pending Approval' },
  { key: 'completed', label: 'Completed' },
]

function applyFilterParams(activeFilter) {
  if (activeFilter === 'active') return { completion: 'OPEN' }
  if (activeFilter === 'completed') return { completion: 'COMPLETED' }
  if (activeFilter === 'pending_approval') return { status: 'DRAFT_PENDING_APPROVAL' }
  return { completion: 'ALL' }
}

function localFilter(rows, activeFilter, query) {
  const q = query.trim().toLowerCase()
  return (rows || []).filter((row) => {
    if (activeFilter === 'draft' && !String(row.status || '').startsWith('DRAFT')) return false
    if (q) {
      const haystack = [
        row.assignment_code,
        row.borrower_name,
        row.bank_name,
        row.bank_or_client,
        row.branch_name,
        row.address,
        row.valuer_client_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })
}

export default function AssignmentsScreen() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const initialFilter = new URLSearchParams(location.search).get('filter') || 'all'
  const partnerMode = isPartner(user)

  const [filter, setFilter] = useState(FILTERS.some((item) => item.key === initialFilter) ? initialFilter : 'all')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        if (partnerMode) {
          const summary = await fetchMobileSummary()
          if (!cancelled) setRows(summary?.my_queue || [])
        } else {
          const params = {
            ...applyFilterParams(filter),
            limit: 120,
            sort_by: 'updated_at',
            sort_dir: 'desc',
          }
          const data = await fetchAssignments(params)
          if (!cancelled) setRows(data || [])
        }
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err, 'Unable to load assignments.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [filter, partnerMode])

  const filtered = useMemo(() => localFilter(rows, filter, query), [rows, filter, query])
  const stats = useMemo(() => ({
    drafts: rows.filter((item) => String(item.status || '').startsWith('DRAFT')).length,
    pendingApproval: rows.filter((item) => String(item.status || '') === 'DRAFT_PENDING_APPROVAL').length,
    completed: rows.filter((item) => String(item.completion_status || item.completion || '').toUpperCase() === 'COMPLETED').length,
    active: rows.filter((item) => !String(item.status || '').startsWith('DRAFT') && String(item.completion_status || item.completion || '').toUpperCase() !== 'COMPLETED').length,
  }), [rows])
  const activeFilterLabel = FILTERS.find((item) => item.key === filter)?.label || 'All'

  return (
    <MobileLayout
      title={partnerMode ? 'My Requests' : 'Assignments'}
      subtitle={partnerMode ? 'Submitted requests, drafts, and due items' : 'Workboard and search'}
      primaryAction={partnerMode ? { label: 'New Request', to: '/m/request/new' } : { label: 'Create', to: '/m/create' }}
      secondaryAction={{ label: 'Search', to: '/m/search' }}
    >
      {error ? <div className="m-alert m-alert-error">{error}</div> : null}

      <Section title={partnerMode ? 'Request Snapshot' : 'Queue Signals'} subtitle={partnerMode ? 'Current mix of drafts, active requests, and completed work.' : 'Live assignment mix for the current mobile session.'}>
        <div className="m-stat-grid">
          <Card className="m-stat-card">
            <p>Drafts</p>
            <strong>{stats.drafts}</strong>
            <small>Drafts still in capture or review staging.</small>
            
          </Card>
          <Card className="m-stat-card">
            <p>Active</p>
            <strong>{stats.active}</strong>
            <small>{partnerMode ? 'Requests that are being worked on right now.' : 'Operational cases moving through field or desk work.'}</small>
          </Card>
          <Card className="m-stat-card">
            <p>Pending Approval</p>
            <strong>{stats.pendingApproval}</strong>
            <small>{partnerMode ? 'Requests waiting for a review decision from the Maulya team.' : 'Items paused at the approval gate.'}</small>
          </Card>
          <Card className="m-stat-card">
            <p>Completed</p>
            <strong>{stats.completed}</strong>
            <small>{partnerMode ? 'Requests that are complete or ready for delivery.' : 'Closed cases visible in the current pull.'}</small>
          </Card>
        </div>
      </Section>

      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder="Search code, customer, village, phone"
      />

      <div className="m-chip-row" role="tablist" aria-label="Assignment filters">
        {FILTERS.map((item) => (
          <Chip key={item.key} active={filter === item.key} onClick={() => setFilter(item.key)}>
            {item.label}
          </Chip>
        ))}
      </div>

      <Section title={partnerMode ? 'Requests' : 'Queue'} subtitle={`${filtered.length} results · filter: ${activeFilterLabel}`}>
        <DemoInlineHelp
          title="Move from queue to context"
          body="This list is the fastest way to open a live request or assignment and inspect its current status."
          whyItMatters="The tutorial uses the queue to move from intake into request detail without losing the operational thread."
        />
        {loading ? <MobileListSkeleton rows={6} /> : null}
        {!loading && filtered.length === 0 ? (
          <MobileEmptyState
            title={partnerMode ? 'No matching requests' : 'No assignments'}
            body={partnerMode ? 'Try a different filter or search term.' : 'Try a different filter or search query.'}
            action={<button type="button" className="m-link-btn" onClick={() => setFilter('all')}>Reset filters</button>}
          />
        ) : null}

        <div className="m-list" data-tour-id="mobile-assignments-list">
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              className="m-list-card"
              data-tour-route={`/m/assignments/${item.id}`}
              onClick={() => navigate(`/m/assignments/${item.id}`)}
            >
              <div className="m-list-top">
                <strong>{item.assignment_code || `#${item.id}`}</strong>
                <span className={`m-status ${String(item.status || '').toLowerCase()}`}>
                  {titleCase(item.status)}
                </span>
              </div>
              <p>{item.bank_or_client || item.bank_name || item.valuer_client_name || item.borrower_name || 'Unknown customer'}</p>
              <div className="m-list-keyline">
                <span>{item.branch_name || item.address || 'No location'}</span>
                <span>Updated {formatDateTime(item.updated_at)}</span>
              </div>
            </button>
          ))}
        </div>
      </Section>
    </MobileLayout>
  )
}
