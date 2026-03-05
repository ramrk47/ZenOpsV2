import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import MobileLayout from '../MobileLayout'
import { Chip, MobileEmptyState, MobileListSkeleton, SearchBar, Section } from '../components/Primitives'
import { fetchAssignments } from '../../api/assignments'
import { formatDateTime, titleCase } from '../../utils/format'
import { toUserMessage } from '../../api/client'

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
        row.branch_name,
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
  const initialFilter = new URLSearchParams(location.search).get('filter') || 'all'

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
        const params = {
          ...applyFilterParams(filter),
          limit: 120,
          sort_by: 'updated_at',
          sort_dir: 'desc',
        }
        const data = await fetchAssignments(params)
        if (!cancelled) setRows(data || [])
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
  }, [filter])

  const filtered = useMemo(() => localFilter(rows, filter, query), [rows, filter, query])

  return (
    <MobileLayout
      title="Assignments"
      subtitle="Search and quick actions"
      primaryAction={{ label: 'Create', to: '/m/create' }}
      secondaryAction={{ label: 'Search', to: '/m/search' }}
    >
      {error ? <div className="m-alert m-alert-error">{error}</div> : null}

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

      <Section title="Queue" subtitle={`${filtered.length} results`}>
        {loading ? <MobileListSkeleton rows={6} /> : null}
        {!loading && filtered.length === 0 ? (
          <MobileEmptyState title="No assignments" body="Try a different filter or search query." />
        ) : null}

        <div className="m-list">
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              className="m-list-card"
              onClick={() => navigate(`/m/assignments/${item.id}`)}
            >
              <div className="m-list-top">
                <strong>{item.assignment_code || `#${item.id}`}</strong>
                <span className={`m-status ${String(item.status || '').toLowerCase()}`}>
                  {titleCase(item.status)}
                </span>
              </div>
              <p>{item.bank_name || item.valuer_client_name || item.borrower_name || 'Unknown customer'}</p>
              <small>
                {item.branch_name || item.address || 'No location'} · Updated {formatDateTime(item.updated_at)}
              </small>
            </button>
          ))}
        </div>
      </Section>
    </MobileLayout>
  )
}
