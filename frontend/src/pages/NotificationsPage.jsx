import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/ui/PageHeader'
import Badge from '../components/ui/Badge'
import { Card, CardHeader } from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import InfoTip from '../components/ui/InfoTip'
import { fetchNotifications, markNotificationRead, markAllNotificationsRead, snoozeNotifications } from '../api/notifications'
import { formatDateTime, titleCase } from '../utils/format'
import { toUserMessage } from '../api/client'
import { loadJson, saveJson } from '../utils/storage'

const FILTERS_KEY = 'zenops.notifications.filters.v1'

function groupKey(notification) {
  const payload = notification.payload_json || {}
  if (payload.assignment_id) return `assignment:${payload.assignment_id}`
  if (payload.invoice_id) return `invoice:${payload.invoice_id}`
  if (payload.approval_id) return `approval:${payload.approval_id}`
  if (payload.leave_request_id) return `leave:${payload.leave_request_id}`
  return `type:${notification.type || 'UNKNOWN'}`
}

function groupTitle(notification) {
  const payload = notification.payload_json || {}
  if (payload.assignment_id) return `Assignment #${payload.assignment_id}`
  if (payload.invoice_id) return `Invoice #${payload.invoice_id}`
  if (payload.approval_id) return `Approval #${payload.approval_id}`
  if (payload.leave_request_id) return `Leave Request #${payload.leave_request_id}`
  return titleCase(notification.type || 'Notification')
}

export default function NotificationsPage() {
  const storedFilters = loadJson(FILTERS_KEY, {})
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [unreadOnly, setUnreadOnly] = useState(Boolean(storedFilters.unreadOnly))
  const [filters, setFilters] = useState({
    type: storedFilters.type || '',
    search: storedFilters.search || '',
    from: storedFilters.from || '',
    to: storedFilters.to || '',
  })
  const [grouped, setGrouped] = useState(storedFilters.grouped !== undefined ? Boolean(storedFilters.grouped) : true)
  const [expandedGroups, setExpandedGroups] = useState(new Set())
  const [includeSnoozed, setIncludeSnoozed] = useState(Boolean(storedFilters.includeSnoozed))
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    saveJson(FILTERS_KEY, {
      unreadOnly,
      includeSnoozed,
      grouped,
      type: filters.type,
      search: filters.search,
      from: filters.from,
      to: filters.to,
    })
  }, [unreadOnly, includeSnoozed, grouped, filters])

  useEffect(() => {
    let cancelled = false

    async function loadNotifications() {
      setLoading(true)
      setError(null)
      try {
        const params = { unread_only: unreadOnly, include_snoozed: includeSnoozed }
        if (filters.type) params.type = filters.type
        if (filters.search) params.search = filters.search
        if (filters.from) params.created_from = new Date(filters.from).toISOString()
        if (filters.to) {
          const toDate = new Date(filters.to)
          toDate.setHours(23, 59, 59, 999)
          params.created_to = toDate.toISOString()
        }
        const data = await fetchNotifications(params)
        if (!cancelled) setNotifications(data)
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load notifications'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadNotifications()
    return () => {
      cancelled = true
    }
  }, [unreadOnly, filters, includeSnoozed, reloadKey])

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read_at).length, [notifications])

  const typeCounts = useMemo(() => {
    const map = new Map()
    notifications.forEach((n) => {
      map.set(n.type, (map.get(n.type) || 0) + 1)
    })
    return map
  }, [notifications])

  const typeOptions = useMemo(() => Array.from(typeCounts.keys()).sort(), [typeCounts])

  const groupedNotifications = useMemo(() => {
    if (!grouped) return []
    const map = new Map()
    notifications.forEach((notification) => {
      const key = groupKey(notification)
      const existing = map.get(key)
      if (!existing) {
        map.set(key, {
          key,
          title: groupTitle(notification),
          items: [notification],
          latest: notification,
          unreadCount: notification.read_at ? 0 : 1,
        })
        return
      }
      existing.items.push(notification)
      if (!notification.read_at) existing.unreadCount += 1
      if (new Date(notification.created_at) > new Date(existing.latest.created_at)) {
        existing.latest = notification
      }
    })
    return Array.from(map.values()).sort((a, b) => (
      new Date(b.latest.created_at) - new Date(a.latest.created_at)
    ))
  }, [notifications, grouped])

  async function handleMarkRead(notification) {
    try {
      const updated = await markNotificationRead(notification.id)
      setNotifications((prev) => prev.map((n) => (n.id === updated.id ? updated : n)))
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to mark notification read'))
    }
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead()
      setNotifications((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })))
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to mark all notifications read'))
    }
  }

  async function handleSnooze(ids, durationMs) {
    try {
      const minutes = Math.max(1, Math.round(durationMs / 60000))
      await snoozeNotifications({ notification_ids: ids, snooze_minutes: minutes })
      setReloadKey((k) => k + 1)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to snooze notifications'))
    }
  }

  function toggleGroup(key) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleMarkGroupRead(group) {
    const unread = group.items.filter((n) => !n.read_at)
    if (!unread.length) return
    try {
      await Promise.all(unread.map((n) => markNotificationRead(n.id)))
      const now = new Date().toISOString()
      const unreadIds = new Set(unread.map((n) => n.id))
      setNotifications((prev) => prev.map((n) => (unreadIds.has(n.id) ? { ...n, read_at: now } : n)))
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to mark group read'))
    }
  }

  function resolveNotificationLink(notification) {
    const payload = notification.payload_json || {}
    if (payload.assignment_id) {
      return `/assignments/${payload.assignment_id}`
    }
    if (payload.invoice_id) {
      return `/invoices?invoice_id=${payload.invoice_id}`
    }
    if (payload.approval_id) {
      return '/admin/approvals'
    }
    if (payload.leave_request_id) {
      return '/requests'
    }
    return null
  }

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Actionable alerts across SLA, approvals, missing docs, and payments."
        actions={(
          <div style={{ display: 'flex', gap: 8 }}>
            <Badge tone={unreadCount > 0 ? 'warn' : 'ok'}>{unreadCount} unread</Badge>
            <button type="button" className="secondary" onClick={handleMarkAllRead} disabled={unreadCount === 0}>
              Mark All Read
            </button>
          </div>
        )}
      />

      <div className="grid cols-4" style={{ marginBottom: '0.9rem' }}>
        {Array.from(typeCounts.entries()).slice(0, 4).map(([type, count]) => (
          <div key={type} className="card tight">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="kicker">{titleCase(type)}</div>
              <InfoTip text="Count of this notification type in the current filter." />
            </div>
            <div className="stat-value">{count}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader
          title="Inbox"
          subtitle={unreadOnly ? 'Unread notifications only' : 'All notifications'}
          action={(
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
                <span className="kicker" style={{ marginTop: 2 }}>Group</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
                <span className="kicker" style={{ marginTop: 2 }}>Unread only</span>
              </label>
              <input
                placeholder="Search"
                value={filters.search}
                onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                style={{ minWidth: 140 }}
              />
              <select
                value={filters.type}
                onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))}
              >
                <option value="">All types</option>
                {typeOptions.map((type) => (
                  <option key={type} value={type}>{titleCase(type)}</option>
                ))}
              </select>
              <input
                type="date"
                value={filters.from}
                onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))}
              />
              <input
                type="date"
                value={filters.to}
                onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={includeSnoozed} onChange={(e) => setIncludeSnoozed(e.target.checked)} />
                <span className="kicker" style={{ marginTop: 2 }}>Show snoozed</span>
              </label>
            </div>
          )}
        />

        {error ? <div className="empty" style={{ marginBottom: '0.8rem' }}>{error}</div> : null}

        {loading ? (
          <div className="muted">Loading notifications…</div>
        ) : notifications.length === 0 ? (
          <EmptyState>No notifications right now. You're caught up.</EmptyState>
        ) : grouped ? (
          <div className="list">
            {groupedNotifications.map((group) => {
              const isExpanded = expandedGroups.has(group.key)
              const link = resolveNotificationLink(group.latest)
              const tone = group.unreadCount > 0 ? 'info' : 'muted'
              return (
                <div key={group.key} className="list-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Badge tone={tone}>{titleCase(group.latest.type)}</Badge>
                        <Badge tone="accent">{group.items.length} events</Badge>
                        {group.unreadCount ? <Badge tone="warn">{group.unreadCount} unread</Badge> : null}
                        {group.latest.snoozed_until ? (
                          <Badge tone="muted">Snoozed until {formatDateTime(group.latest.snoozed_until)}</Badge>
                        ) : null}
                        <span className="muted" style={{ fontSize: 12 }}>{formatDateTime(group.latest.created_at)}</span>
                      </div>
                      <div style={{ fontWeight: 600 }}>{group.title}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{group.latest.message}</div>
                    </div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {group.unreadCount ? (
                        <button type="button" className="secondary" onClick={() => handleMarkGroupRead(group)}>
                          Mark Group Read
                        </button>
                      ) : (
                        <Badge tone="ok">Read</Badge>
                      )}
                      <button type="button" className="ghost" onClick={() => handleSnooze(group.items.map((n) => n.id), 60 * 60 * 1000)}>
                        Snooze 1h
                      </button>
                      <button type="button" className="ghost" onClick={() => handleSnooze(group.items.map((n) => n.id), 24 * 60 * 60 * 1000)}>
                        Snooze 1d
                      </button>
                      {link ? (
                        <Link className="nav-link" to={link}>Open</Link>
                      ) : null}
                      <button type="button" className="ghost" onClick={() => toggleGroup(group.key)}>
                        {isExpanded ? 'Hide' : 'Show'} {group.items.length} items
                      </button>
                    </div>
                  </div>
                  {isExpanded ? (
                    <div className="list" style={{ marginTop: 10 }}>
                      {group.items.map((notification) => {
                        const isUnread = !notification.read_at
                        const itemTone = isUnread ? 'info' : 'muted'
                        const itemLink = resolveNotificationLink(notification)
                        return (
                          <div key={notification.id} className="list-item" style={{ background: 'rgba(18, 26, 51, 0.7)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                              <div style={{ display: 'grid', gap: 4 }}>
                                <Badge tone={itemTone}>{titleCase(notification.type)}</Badge>
                                <div style={{ fontWeight: 600 }}>{notification.message}</div>
                                {notification.snoozed_until ? (
                                  <div className="muted" style={{ fontSize: 12 }}>
                                    Snoozed until {formatDateTime(notification.snoozed_until)}
                                  </div>
                                ) : null}
                                <div className="muted" style={{ fontSize: 12 }}>{formatDateTime(notification.created_at)}</div>
                              </div>
                              <div style={{ display: 'grid', gap: 6 }}>
                                {isUnread ? (
                                  <button type="button" className="secondary" onClick={() => handleMarkRead(notification)}>
                                    Mark Read
                                  </button>
                                ) : (
                                  <Badge tone="ok">Read</Badge>
                                )}
                                {itemLink ? <Link className="nav-link" to={itemLink}>Open</Link> : null}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="list">
            {notifications.map((notification) => {
              const isUnread = !notification.read_at
              const tone = isUnread ? 'info' : 'muted'
              const link = resolveNotificationLink(notification)
              return (
                <div key={notification.id} className="list-item" style={isUnread ? { borderColor: 'rgba(122, 162, 255, 0.6)' } : undefined}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Badge tone={tone}>{titleCase(notification.type)}</Badge>
                        {notification.snoozed_until ? (
                          <Badge tone="muted">Snoozed until {formatDateTime(notification.snoozed_until)}</Badge>
                        ) : null}
                        <span className="muted" style={{ fontSize: 12 }}>{formatDateTime(notification.created_at)}</span>
                      </div>
                      <div style={{ fontWeight: 600 }}>{notification.message}</div>
                      {notification.payload_json ? (
                        <pre style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                          {JSON.stringify(notification.payload_json, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {isUnread ? (
                        <button type="button" className="secondary" onClick={() => handleMarkRead(notification)}>
                          Mark Read
                        </button>
                      ) : (
                        <Badge tone="ok">Read</Badge>
                      )}
                      <button type="button" className="ghost" onClick={() => handleSnooze([notification.id], 60 * 60 * 1000)}>
                        Snooze 1h
                      </button>
                      <button type="button" className="ghost" onClick={() => handleSnooze([notification.id], 24 * 60 * 60 * 1000)}>
                        Snooze 1d
                      </button>
                      {link ? (
                        <Link className="nav-link" to={link}>Open</Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
