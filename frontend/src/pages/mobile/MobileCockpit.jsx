import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext.jsx'
import { fetchMobileSummary } from '../../api/mobile'
import { formatDateTime, titleCase } from '../../utils/format'
import {
  appendStatusHistory,
  readStatusHistory,
  readSummarySnapshot,
  writeSummarySnapshot,
} from '../../utils/mobileSnapshots'

const CARD_DEFS = [
  { key: 'unread_notifications', label: 'Unread Notifications' },
  { key: 'approvals_pending', label: 'Approvals Pending' },
  { key: 'overdue_assignments', label: 'Overdue Assignments' },
  { key: 'payments_pending', label: 'Payments Pending' },
]

function getInitials(user) {
  const source = user?.full_name || user?.email || 'U'
  const parts = source.split(' ').filter(Boolean)
  if (!parts.length) return 'U'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}

function queueSortKey(item) {
  if (item?.due_state === 'OVERDUE') return 0
  if (item?.due_state === 'DUE_SOON') return 1
  return 2
}

function normalizeSummary(summary) {
  if (!summary) return null
  const queue = Array.isArray(summary.my_queue) ? [...summary.my_queue] : []
  queue.sort((a, b) => {
    const dueRank = queueSortKey(a) - queueSortKey(b)
    if (dueRank !== 0) return dueRank

    const aDue = a?.due_time ? new Date(a.due_time).getTime() : Number.MAX_SAFE_INTEGER
    const bDue = b?.due_time ? new Date(b.due_time).getTime() : Number.MAX_SAFE_INTEGER
    if (aDue !== bDue) return aDue - bDue

    const aUpdated = a?.updated_at ? new Date(a.updated_at).getTime() : 0
    const bUpdated = b?.updated_at ? new Date(b.updated_at).getTime() : 0
    return bUpdated - aUpdated
  })
  return { ...summary, my_queue: queue.slice(0, 20) }
}

function OfflineBanner({ usingCache, offline }) {
  if (!usingCache && !offline) return null
  return (
    <div className="mobile-banner" role="status">
      {offline
        ? 'You are offline. Showing last available status snapshot.'
        : 'Network issue detected. Showing last available status snapshot.'}
    </div>
  )
}

export default function MobileCockpit() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()

  const [summary, setSummary] = useState(null)
  const [statusHistory, setStatusHistory] = useState(() => readStatusHistory())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [usingCache, setUsingCache] = useState(false)
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' ? !navigator.onLine : false)

  const loadSummary = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    setError('')

    try {
      const data = normalizeSummary(await fetchMobileSummary())
      setSummary(data)
      setUsingCache(false)
      writeSummarySnapshot(data)
      appendStatusHistory(data)
      setStatusHistory(readStatusHistory())
    } catch (err) {
      const cached = normalizeSummary(readSummarySnapshot())
      if (cached) {
        setSummary(cached)
        setUsingCache(true)
      } else {
        setError(err?.response?.data?.detail || 'Unable to load mobile summary right now.')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  useEffect(() => {
    function onOnline() {
      setOffline(false)
      loadSummary({ silent: true })
    }
    function onOffline() {
      setOffline(true)
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [loadSummary])

  const queue = useMemo(() => (Array.isArray(summary?.my_queue) ? summary.my_queue : []), [summary])

  return (
    <div className="mobile-shell">
      <header className="mobile-header">
        <div>
          <p className="mobile-kicker">Zen Ops Mobile Cockpit</p>
          <h1>Zen Ops</h1>
        </div>
        <div className="mobile-header-actions">
          <button
            type="button"
            className="mobile-avatar"
            title={user?.full_name || user?.email || 'User'}
            onClick={() => navigate('/')}
          >
            {getInitials(user)}
          </button>
          <button type="button" className="mobile-ghost-btn" onClick={logout}>Logout</button>
        </div>
      </header>

      <OfflineBanner usingCache={usingCache} offline={offline} />

      <div className="mobile-toolbar">
        <span className="mobile-updated-at">
          Updated: {formatDateTime(summary?.generated_at || summary?.cached_at)}
        </span>
        <button type="button" className="mobile-refresh-btn" onClick={() => loadSummary()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error ? <div className="mobile-error">{error}</div> : null}

      <section className="mobile-status-grid" aria-label="Status cards">
        {CARD_DEFS.map((card) => (
          <article key={card.key} className="mobile-status-card">
            <p>{card.label}</p>
            <strong>{summary ? Number(summary[card.key] || 0) : '—'}</strong>
          </article>
        ))}
      </section>

      <section className="mobile-panel" aria-label="My queue">
        <div className="mobile-panel-head">
          <h2>My Queue</h2>
          <span>{queue.length} items</span>
        </div>

        {loading && !summary ? <p className="mobile-muted">Loading queue…</p> : null}

        {!loading && !queue.length ? (
          <div className="mobile-empty">
            <p>No active assignments in your queue.</p>
          </div>
        ) : null}

        <div className="mobile-queue-list">
          {queue.map((item) => (
            <button
              key={item.id}
              type="button"
              className="mobile-queue-item"
              onClick={() => navigate(`/m/assignments/${item.id}`)}
            >
              <div className="mobile-queue-top">
                <strong>{item.assignment_code} · #{item.id}</strong>
                <span className="mobile-status-pill">{titleCase(item.status)}</span>
              </div>
              <p className="mobile-queue-client">{item.bank_or_client || item.borrower_name || 'Unknown client'}</p>
              <p className="mobile-queue-meta">
                Due {formatDateTime(item.due_time)} · Updated {formatDateTime(item.updated_at)}
              </p>
              <p className="mobile-queue-action">Next: {item.next_action}</p>
              <div className="mobile-badge-row">
                {(item.badges || []).map((badge) => (
                  <span key={badge} className={`mobile-badge mobile-badge-${badge.toLowerCase()}`}>{badge}</span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="mobile-panel" aria-label="Recent snapshots">
        <div className="mobile-panel-head">
          <h2>Recent Status Snapshots</h2>
          <span>{statusHistory.length}</span>
        </div>
        {!statusHistory.length ? <p className="mobile-muted">No cached snapshots yet.</p> : null}
        <div className="mobile-history-list">
          {statusHistory.slice(0, 5).map((entry) => (
            <div key={entry.generated_at} className="mobile-history-item">
              <span>{formatDateTime(entry.generated_at)}</span>
              <span>N:{entry.unread_notifications}</span>
              <span>A:{entry.approvals_pending}</span>
              <span>O:{entry.overdue_assignments}</span>
              <span>P:{entry.payments_pending}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
