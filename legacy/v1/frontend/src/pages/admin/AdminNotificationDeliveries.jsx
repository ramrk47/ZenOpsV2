import React, { useEffect, useMemo, useState } from 'react'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import DataTable from '../../components/ui/DataTable'
import InfoTip from '../../components/ui/InfoTip'
import { fetchNotificationDeliveries } from '../../api/notifications'
import { formatDateTime, titleCase } from '../../utils/format'
import { loadJson, saveJson } from '../../utils/storage'
import { toUserMessage } from '../../api/client'

const FILTERS_KEY = 'zenops.notificationDeliveries.filters.v1'

const CHANNEL_OPTIONS = ['ALL', 'IN_APP', 'EMAIL']
const STATUS_OPTIONS = ['ALL', 'PENDING', 'SENT', 'FAILED']

function statusTone(status) {
  if (status === 'SENT') return 'ok'
  if (status === 'FAILED') return 'danger'
  if (status === 'PENDING') return 'warn'
  return 'muted'
}

export default function AdminNotificationDeliveries() {
  const [deliveries, setDeliveries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const [filters, setFilters] = useState(() => loadJson(FILTERS_KEY, {
    channel: 'EMAIL',
    status: '',
    type: '',
    user_id: '',
    search: '',
    created_from: '',
    created_to: '',
    limit: 200,
  }))

  useEffect(() => {
    saveJson(FILTERS_KEY, filters)
  }, [filters])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const params = { limit: Number(filters.limit) || 200 }
        if (filters.channel && filters.channel !== 'ALL') params.channel = filters.channel
        if (filters.status && filters.status !== 'ALL') params.status = filters.status
        if (filters.type) params.type = filters.type
        if (filters.user_id) params.user_id = Number(filters.user_id)
        if (filters.created_from) params.created_from = new Date(filters.created_from).toISOString()
        if (filters.created_to) {
          const toDate = new Date(filters.created_to)
          toDate.setHours(23, 59, 59, 999)
          params.created_to = toDate.toISOString()
        }

        const data = await fetchNotificationDeliveries(params)
        if (!cancelled) setDeliveries(data)
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load notification deliveries'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [filters.channel, filters.status, filters.type, filters.user_id, filters.created_from, filters.created_to, filters.limit])

  const visible = useMemo(() => {
    const query = filters.search.trim().toLowerCase()
    if (!query) return deliveries
    return deliveries.filter((row) => {
      const haystack = [
        row.to_address,
        row.user_email,
        row.notification_message,
        row.notification_type,
        row.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [deliveries, filters.search])

  const counts = useMemo(() => {
    const tally = { pending: 0, sent: 0, failed: 0 }
    visible.forEach((row) => {
      if (row.status === 'PENDING') tally.pending += 1
      else if (row.status === 'SENT') tally.sent += 1
      else if (row.status === 'FAILED') tally.failed += 1
    })
    return tally
  }, [visible])

  return (
    <div>
      <PageHeader
        title="Notification Deliveries"
        subtitle="Track email delivery attempts and failures. In-app deliveries are auto-marked sent."
        actions={<Badge tone={counts.failed > 0 ? 'danger' : 'info'}>{counts.failed} failed</Badge>}
      />

      {error ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{error}</div> : null}

      <div className="grid cols-3" style={{ marginBottom: '0.9rem' }}>
        <div className="card tight">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="kicker">Pending</div>
            <InfoTip text="Queued for the worker." />
          </div>
          <div className="stat-value">{counts.pending}</div>
        </div>
        <div className="card tight">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="kicker">Sent</div>
            <InfoTip text="Delivered successfully." />
          </div>
          <div className="stat-value">{counts.sent}</div>
        </div>
        <div className="card tight">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="kicker">Failed</div>
            <InfoTip text="Failed delivery attempts — check error for details." />
          </div>
          <div className="stat-value" style={{ color: counts.failed > 0 ? 'var(--danger)' : undefined }}>
            {counts.failed}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Deliveries"
          subtitle="Filter by channel, status, user, or date."
        />

        <div className="filter-shell" style={{ marginBottom: '0.8rem' }}>
          <div className="toolbar dense">
            <input
              className="grow"
              placeholder="Search recipient, type, message"
              value={filters.search}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
            />
            <button type="button" className="secondary" onClick={() => setFiltersOpen((open) => !open)}>
              {filtersOpen ? 'Hide Filters' : 'Filters'}
            </button>
            <Badge tone="info">{visible.length} shown</Badge>
          </div>
          {filtersOpen ? (
            <div className="filter-panel">
              <div className="filter-grid">
                <select value={filters.channel} onChange={(e) => setFilters((prev) => ({ ...prev, channel: e.target.value }))}>
                  {CHANNEL_OPTIONS.map((channel) => (
                    <option key={channel} value={channel}>{titleCase(channel)}</option>
                  ))}
                </select>
                <select value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>{titleCase(status)}</option>
                  ))}
                </select>
                <input
                  placeholder="Notification type (optional)"
                  value={filters.type}
                  onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value.toUpperCase() }))}
                />
                <input
                  placeholder="User ID"
                  value={filters.user_id}
                  onChange={(e) => setFilters((prev) => ({ ...prev, user_id: e.target.value }))}
                />
                <label style={{ display: 'grid', gap: 6 }}>
                  <span className="kicker">Created From</span>
                  <input
                    type="date"
                    value={filters.created_from}
                    onChange={(e) => setFilters((prev) => ({ ...prev, created_from: e.target.value }))}
                  />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span className="kicker">Created To</span>
                  <input
                    type="date"
                    value={filters.created_to}
                    onChange={(e) => setFilters((prev) => ({ ...prev, created_to: e.target.value }))}
                  />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span className="kicker">Limit</span>
                  <input
                    type="number"
                    min="50"
                    max="500"
                    step="50"
                    value={filters.limit}
                    onChange={(e) => setFilters((prev) => ({ ...prev, limit: e.target.value }))}
                  />
                </label>
              </div>
            </div>
          ) : null}
        </div>

        {loading ? (
          <DataTable loading columns={8} rows={6} />
        ) : visible.length === 0 ? (
          <EmptyState>No deliveries match the current filters.</EmptyState>
        ) : (
          <DataTable>
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Recipient</th>
                  <th>Attempts</th>
                  <th>Last Attempt</th>
                  <th>Sent</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <strong>{titleCase(row.notification_type || '—')}</strong>
                        <span className="muted" style={{ fontSize: 12 }}>{row.notification_message || '—'}</span>
                      </div>
                    </td>
                    <td>{titleCase(row.channel)}</td>
                    <td>
                      <Badge tone={statusTone(row.status)}>{titleCase(row.status)}</Badge>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span>{row.to_address || row.user_email || '—'}</span>
                        {row.user_id ? <span className="muted" style={{ fontSize: 12 }}>User #{row.user_id}</span> : null}
                      </div>
                    </td>
                    <td>{row.attempts ?? 0}</td>
                    <td>{formatDateTime(row.last_attempt_at)}</td>
                    <td>{formatDateTime(row.sent_at)}</td>
                    <td>{formatDateTime(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
        )}
      </Card>
    </div>
  )
}
