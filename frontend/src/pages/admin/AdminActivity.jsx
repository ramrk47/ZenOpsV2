import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import InfoTip from '../../components/ui/InfoTip'
import DataTable from '../../components/ui/DataTable'
import { fetchActivity } from '../../api/activity'
import { fetchUsers } from '../../api/users'
import { formatDateTime, titleCase } from '../../utils/format'
import { toUserMessage } from '../../api/client'
import { loadJson, saveJson } from '../../utils/storage'

const FILTERS_KEY = 'zenops.activity.filters.v1'

export default function AdminActivity() {
  const [activities, setActivities] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [filters, setFilters] = useState(() => loadJson(FILTERS_KEY, {
    actor_user_id: '',
    activity_type: '',
    limit: 120,
  }))
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    saveJson(FILTERS_KEY, filters)
  }, [filters])

  useEffect(() => {
    let cancelled = false

    fetchUsers()
      .then((data) => {
        if (!cancelled) setUsers(data)
      })
      .catch((err) => {
        console.warn('Unable to load full user list for activity filters.', err)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadActivity() {
      setLoading(true)
      setError(null)
      try {
        const params = {
          limit: Number(filters.limit) || 120,
        }
        if (filters.actor_user_id) params.actor_user_id = Number(filters.actor_user_id)
        if (filters.activity_type) params.activity_type = filters.activity_type

        const data = await fetchActivity(params)
        if (!cancelled) setActivities(data)
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load activity'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadActivity()
    return () => {
      cancelled = true
    }
  }, [filters, reloadKey])

  const userMap = useMemo(() => {
    const map = new Map()
    users.forEach((u) => map.set(String(u.id), u))
    return map
  }, [users])

  const typeCounts = useMemo(() => {
    const map = new Map()
    activities.forEach((activity) => {
      map.set(activity.type, (map.get(activity.type) || 0) + 1)
    })
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [activities])

  const availableTypes = typeCounts.map(([type]) => type)

  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div>
      <PageHeader
        title="Activity Feed"
        subtitle="System-wide audit trail — including logins, leave, approvals, and assignment changes."
        actions={<Badge tone="info">{activities.length} events</Badge>}
      />

      {error ? <div className="empty" style={{ marginBottom: '0.8rem' }}>{error}</div> : null}

      <div className="grid cols-4" style={{ marginBottom: '0.9rem' }}>
        {typeCounts.slice(0, 4).map(([type, count]) => (
          <div key={type} className="card tight">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="kicker">{titleCase(type)}</div>
              <InfoTip text="Events of this type in the current view." />
            </div>
            <div className="stat-value">{count}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader
          title="Recent Activity"
          subtitle="Filter by person or activity type."
        />

        <div className="filter-shell" style={{ marginBottom: '0.8rem' }}>
          <div className="toolbar dense">
            <button type="button" className="secondary" onClick={() => setFiltersOpen((open) => !open)}>
              {filtersOpen ? 'Hide Filters' : 'Filters'}
            </button>
            <button type="button" className="secondary" onClick={() => setReloadKey((k) => k + 1)}>
              Refresh
            </button>
            <Badge tone="info">{activities.length} events</Badge>
          </div>
          {filtersOpen ? (
            <div className="filter-panel">
              <div className="filter-grid">
                <select value={filters.actor_user_id} onChange={(e) => updateFilter('actor_user_id', e.target.value)}>
                  <option value="">All People</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>{user.full_name || user.email}</option>
                  ))}
                </select>

                <select value={filters.activity_type} onChange={(e) => updateFilter('activity_type', e.target.value)}>
                  <option value="">All Types</option>
                  {availableTypes.map((type) => (
                    <option key={type} value={type}>{titleCase(type)}</option>
                  ))}
                </select>

                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="kicker" style={{ marginTop: 2 }}>Limit</span>
                  <input
                    type="number"
                    min="20"
                    max="500"
                    step="10"
                    value={filters.limit}
                    onChange={(e) => updateFilter('limit', e.target.value)}
                    style={{ width: 96 }}
                  />
                </label>
              </div>
            </div>
          ) : null}
        </div>

        {loading ? (
          <DataTable loading columns={5} rows={6} />
        ) : activities.length === 0 ? (
          <EmptyState>No activity found for the current filters.</EmptyState>
        ) : (
          <div className="list">
            {activities.map((activity) => {
              const actor = activity.actor_user_id ? userMap.get(String(activity.actor_user_id)) : null
              const actorLabel = actor?.full_name || actor?.email || activity.actor_user_id || 'System'
              const tone = activity.type === 'USER_LOGIN' ? 'info' : activity.assignment_id ? 'accent' : 'muted'
              return (
                <div key={activity.id} className="list-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ display: 'grid', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Badge tone={tone}>{titleCase(activity.type)}</Badge>
                        {activity.assignment_id ? <Badge tone="accent">Assignment #{activity.assignment_id}</Badge> : null}
                      </div>
                      {activity.message ? <div style={{ fontWeight: 600 }}>{activity.message}</div> : null}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {actorLabel} · {formatDateTime(activity.created_at)}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                      {activity.assignment_id ? (
                        <Link to={`/assignments/${activity.assignment_id}`} className="link-button">
                          Open assignment
                        </Link>
                      ) : null}
                      {activity.payload_json ? (
                        <pre style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', maxWidth: 360, whiteSpace: 'pre-wrap' }}>
                          {JSON.stringify(activity.payload_json, null, 2)}
                        </pre>
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
