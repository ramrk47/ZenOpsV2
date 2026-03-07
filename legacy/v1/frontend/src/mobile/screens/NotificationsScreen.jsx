import React, { useEffect, useState } from 'react'
import MobileLayout from '../MobileLayout'
import { Card, Chip, MobileEmptyState, MobileListSkeleton, Section } from '../components/Primitives'
import { fetchNotifications, markNotificationRead } from '../../api/notifications'
import { fetchPartnerNotifications, markPartnerNotificationRead } from '../../api/partner'
import { formatDateTime, titleCase } from '../../utils/format'
import { toUserMessage } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { isPartner } from '../../utils/rbac'

export default function NotificationsScreen() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(true)
  const partnerMode = isPartner(user)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        const data = partnerMode
          ? await fetchPartnerNotifications({ unread_only: unreadOnly, include_snoozed: false, limit: 50 })
          : await fetchNotifications({ unread_only: unreadOnly, include_snoozed: false })
        if (!cancelled) setRows(data || [])
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err, 'Unable to load notifications.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [partnerMode, unreadOnly])

  async function handleRead(row) {
    try {
      const updated = partnerMode
        ? await markPartnerNotificationRead(row.id)
        : await markNotificationRead(row.id)
      setRows((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
    } catch (err) {
      setError(toUserMessage(err, 'Unable to mark notification read.'))
    }
  }

  const unreadCount = rows.filter((row) => !row.read_at).length

  return (
    <MobileLayout title="Notifications" subtitle="Actionable alerts">
      {error ? <div className="m-alert m-alert-error">{error}</div> : null}

      {!loading ? (
        <Section title="Alert Signals" subtitle="What still needs attention from this inbox.">
          <div className="m-stat-grid">
            <Card className="m-stat-card">
              <p>Unread</p>
              <strong>{unreadCount}</strong>
              <small>Alerts still awaiting acknowledgement.</small>
            </Card>
            <Card className="m-stat-card">
              <p>Total</p>
              <strong>{rows.length}</strong>
              <small>Notifications currently visible in this filter.</small>
            </Card>
          </div>
        </Section>
      ) : null}

      <div className="m-chip-row">
        <Chip active={unreadOnly} onClick={() => setUnreadOnly(true)}>Unread</Chip>
        <Chip active={!unreadOnly} onClick={() => setUnreadOnly(false)}>All</Chip>
      </div>

      <Section title="Alerts" subtitle={`${rows.length} items`}>
        {loading ? <MobileListSkeleton rows={6} /> : null}
        {!loading && rows.length === 0 ? (
          <MobileEmptyState
            title="No notifications"
            body="You are all caught up."
            action={<button type="button" className="m-link-btn" onClick={() => setUnreadOnly(false)}>Show all alerts</button>}
          />
        ) : null}

        <div className="m-list">
          {rows.map((row) => (
            <div className="m-list-card" key={row.id}>
              <div className="m-list-top">
                <strong>{titleCase(row.type)}</strong>
                <span className={`m-status ${row.read_at ? 'completed' : 'pending'}`}>
                  {row.read_at ? 'Read' : 'Unread'}
                </span>
              </div>
              <p>{row.message}</p>
              <div className="m-list-keyline">
                <span>{formatDateTime(row.created_at)}</span>
              </div>
              {!row.read_at ? (
                <div className="m-inline-actions">
                  <button type="button" className="m-link-btn" onClick={() => handleRead(row)}>Mark Read</button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Section>
    </MobileLayout>
  )
}
