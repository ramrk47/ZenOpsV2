import React, { useEffect, useMemo, useState } from 'react'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import { fetchPartnerNotifications, markAllPartnerNotificationsRead, markPartnerNotificationRead } from '../../api/partner'
import { formatDateTime, titleCase } from '../../utils/format'
import { toUserMessage } from '../../api/client'

export default function PartnerNotifications() {
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await fetchPartnerNotifications({ limit: 100 })
        if (!cancelled) setNotifications(data)
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load notifications'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read_at).length, [notifications])

  async function handleMarkAllRead() {
    try {
      await markAllPartnerNotificationsRead()
      const now = new Date().toISOString()
      setNotifications((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })))
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to mark all read'))
    }
  }

  async function handleMarkRead(notification) {
    try {
      const updated = await markPartnerNotificationRead(notification.id)
      setNotifications((prev) => prev.map((n) => (n.id === updated.id ? updated : n)))
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to mark read'))
    }
  }

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Partner-visible updates only."
        actions={(
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Badge tone={unreadCount > 0 ? 'warn' : 'ok'}>{unreadCount} unread</Badge>
            <button type="button" className="secondary" onClick={handleMarkAllRead} disabled={unreadCount === 0}>
              Mark All Read
            </button>
          </div>
        )}
      />

      {error ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{error}</div> : null}

      <Card>
        <CardHeader title="Updates" subtitle="Latest actions from the admin team." />
        {loading ? (
          <div className="muted">Loading notifications…</div>
        ) : notifications.length === 0 ? (
          <EmptyState>No notifications yet.</EmptyState>
        ) : (
          <div className="list">
            {notifications.map((note) => (
              <div key={note.id} className="list-item" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{titleCase(note.type || 'Update')}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{note.message}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{formatDateTime(note.created_at)}</div>
                </div>
                {!note.read_at ? (
                  <button type="button" className="ghost" onClick={() => handleMarkRead(note)}>Mark Read</button>
                ) : (
                  <Badge tone="ok">Read</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
