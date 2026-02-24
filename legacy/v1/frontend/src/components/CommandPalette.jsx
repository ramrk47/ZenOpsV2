import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchAssignments } from '../api/assignments'
import { useAuth } from '../auth/AuthContext'
import { canSeeAdmin, canViewAnalytics, hasCapability, isPartner } from '../utils/rbac'

export default function CommandPalette() {
  const navigate = useNavigate()
  const { capabilities, user } = useAuth()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    function onKeyDown(event) {
      const key = typeof event?.key === 'string' ? event.key : ''
      if (!key) return
      const isK = key.toLowerCase() === 'k'
      if ((event.metaKey || event.ctrlKey) && isK) {
        event.preventDefault()
        setOpen((prev) => !prev)
      }
      if (key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!open) return
    if (assignments.length > 0) return
    let cancelled = false
    setLoading(true)
    fetchAssignments({ completion: 'ALL' })
      .then((data) => {
        if (!cancelled) setAssignments(data)
      })
      .catch((err) => console.error(err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, assignments.length])

  const actions = useMemo(() => {
    const items = [
      { label: 'My Day', to: '/account' },
      { label: 'My Account', to: '/account#my-account' },
      { label: 'My Tasks', to: '/account#tasks' },
      { label: 'My Assignments', to: '/assignments?mine=true' },
      { label: 'Assignments', to: '/assignments' },
      { label: 'New Assignment', to: '/assignments/new', enabled: hasCapability(capabilities, 'create_assignment') },
      { label: 'Request Leave', to: '/requests' },
      { label: 'Request Approval', to: '/requests' },
      { label: 'Approvals', to: '/admin/approvals', enabled: canSeeAdmin(capabilities) },
      { label: 'Invoices', to: '/invoices', enabled: hasCapability(capabilities, 'view_invoices') || hasCapability(capabilities, 'view_all_assignments') },
      { label: 'Master Data', to: '/admin/masterdata', enabled: canSeeAdmin(capabilities) },
      { label: 'Workload', to: '/admin/workload', enabled: canSeeAdmin(capabilities) },
      { label: 'Analytics', to: '/admin/analytics', enabled: canViewAnalytics(capabilities) },
      { label: 'Calendar', to: '/calendar' },
      { label: 'Notifications', to: '/notifications' },
      { label: 'Requests', to: '/requests' },
    ]
    return items.filter((item) => item.enabled !== false)
  }, [capabilities])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = []

    actions.forEach((action) => {
      if (!q || action.label.toLowerCase().includes(q)) {
        matches.push({ type: 'action', label: action.label, to: action.to })
      }
    })

    if (q.length >= 2) {
      assignments
        .filter((a) => {
          const haystack = `${a.assignment_code} ${a.borrower_name || ''} ${a.bank_name || ''} ${a.branch_name || ''}`.toLowerCase()
          return haystack.includes(q)
        })
        .slice(0, 8)
        .forEach((a) => {
          matches.push({
            type: 'assignment',
            label: `${a.assignment_code} · ${a.borrower_name || 'Borrower'} · ${a.bank_name || a.valuer_client_name || a.case_type}`,
            to: `/assignments/${a.id}`,
          })
        })
    }

    return matches
  }, [actions, assignments, query])

  if (!open) return null
  if (isPartner(user)) return null

  return (
    <div className="command-palette-backdrop" onClick={() => setOpen(false)}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <input
          id="commandPaletteSearch"
          name="commandPaletteSearch"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search assignments or jump to a page…"
        />
        {loading ? <div className="muted" style={{ padding: '0.6rem 0' }}>Loading…</div> : null}
        <div className="list">
          {results.length === 0 ? (
            <div className="muted" style={{ padding: '0.6rem 0' }}>No matches.</div>
          ) : (
            results.map((item, index) => (
              <button
                key={`${item.type}-${index}`}
                type="button"
                className="list-item"
                onClick={() => {
                  setOpen(false)
                  navigate(item.to)
                }}
                style={{ textAlign: 'left' }}
              >
                <div style={{ fontWeight: 600 }}>{item.label}</div>
                <div className="muted" style={{ fontSize: 11 }}>{item.type === 'assignment' ? 'Assignment' : 'Shortcut'}</div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
