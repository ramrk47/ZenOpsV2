import React, { useEffect, useState } from 'react'
import { fetchAttendance, exportAttendanceCsvUrl } from '../../api/attendance'
import api from '../../api/client'
import PageHeader from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import EmptyState from '../../components/ui/EmptyState'
import { formatDateTime } from '../../utils/format'

export default function AdminAttendance() {
  const [sessions, setSessions] = useState([])
  const [users, setUsers] = useState([])
  const [filters, setFilters] = useState({ userId: '', fromDate: '', toDate: '' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/api/auth/users/directory').then((r) => setUsers(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchAttendance({
      userId: filters.userId || undefined,
      fromDate: filters.fromDate || undefined,
      toDate: filters.toDate || undefined,
    })
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [filters])

  function handleExport() {
    const url = exportAttendanceCsvUrl({
      userId: filters.userId || undefined,
      fromDate: filters.fromDate || undefined,
      toDate: filters.toDate || undefined,
    })
    const token = localStorage.getItem('token')
    const base = api.defaults.baseURL || ''
    const fullUrl = `${base}${url}`
    fetch(fullUrl, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'attendance.csv'
        a.click()
        URL.revokeObjectURL(a.href)
      })
      .catch(() => alert('Export failed'))
  }

  const userMap = Object.fromEntries(users.map((u) => [u.id, u]))
  const activeCount = sessions.filter((s) => !s.logout_at).length
  const hasFilters = filters.userId || filters.fromDate || filters.toDate

  return (
    <div>
      <PageHeader
        title="Attendance"
        subtitle="Track work sessions across the team."
        actions={
          <button className="secondary" onClick={handleExport}>
            Export CSV
          </button>
        }
      />

      <div className="toolbar dense">
        <select
          value={filters.userId}
          onChange={(e) => setFilters((f) => ({ ...f, userId: e.target.value }))}
        >
          <option value="">All Users</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name || u.email}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={filters.fromDate}
          onChange={(e) => setFilters((f) => ({ ...f, fromDate: e.target.value }))}
          placeholder="From"
        />
        <input
          type="date"
          value={filters.toDate}
          onChange={(e) => setFilters((f) => ({ ...f, toDate: e.target.value }))}
          placeholder="To"
        />
        {hasFilters && (
          <button
            className="ghost"
            onClick={() => setFilters({ userId: '', fromDate: '', toDate: '' })}
          >
            Clear
          </button>
        )}
        {activeCount > 0 && (
          <Badge tone="ok">{activeCount} active now</Badge>
        )}
      </div>

      <Card>
        <CardHeader
          title="Work Sessions"
          subtitle={`${sessions.length} sessions found`}
        />
        {loading ? (
          <div className="muted">Loading sessions...</div>
        ) : sessions.length === 0 ? (
          <EmptyState>No sessions found for the selected filters.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Login</th>
                  <th>Last Seen</th>
                  <th>Logout</th>
                  <th>Duration</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const u = userMap[s.user_id]
                  return (
                    <tr key={s.id}>
                      <td><strong>{u ? u.full_name || u.email : `User #${s.user_id}`}</strong></td>
                      <td>{formatDateTime(s.login_at)}</td>
                      <td>{formatDateTime(s.last_seen_at)}</td>
                      <td>
                        {s.logout_at
                          ? formatDateTime(s.logout_at)
                          : <Badge tone="ok">Active</Badge>
                        }
                      </td>
                      <td>{s.duration_minutes != null ? `${s.duration_minutes} min` : '—'}</td>
                      <td><Badge tone="muted">{s.session_type}</Badge></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
