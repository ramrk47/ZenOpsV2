import React, { useEffect, useState } from 'react'
import api, { toUserMessage } from '../../api/client'
import PageHeader from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import EmptyState from '../../components/ui/EmptyState'
import { formatDate } from '../../utils/format'

export default function AdminPartnerRequests() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(null)

  useEffect(() => {
    loadRequests()
  }, [])

  async function loadRequests() {
    setLoading(true)
    try {
      const res = await api.get('/api/admin/partner-account-requests')
      setRequests(res.data)
    } catch {
      setRequests([])
    } finally {
      setLoading(false)
    }
  }

  async function handleApprove(id) {
    if (!window.confirm('Approve this partner request? An account will be created.')) return
    setActionLoading(id)
    try {
      await api.post(`/api/admin/partner-account-requests/${id}/approve`)
      await loadRequests()
    } catch (err) {
      alert(toUserMessage(err, 'Approval failed'))
    } finally {
      setActionLoading(null)
    }
  }

  async function handleReject(id) {
    const reason = window.prompt('Rejection reason (optional):')
    if (reason === null) return
    setActionLoading(id)
    try {
      await api.post(`/api/admin/partner-account-requests/${id}/reject`, { rejection_reason: reason || null })
      await loadRequests()
    } catch (err) {
      alert(toUserMessage(err, 'Rejection failed'))
    } finally {
      setActionLoading(null)
    }
  }

  const pending = requests.filter((r) => r.status === 'PENDING')
  const decided = requests.filter((r) => r.status !== 'PENDING')

  return (
    <div>
      <PageHeader
        title="Partner Access Requests"
        subtitle="Review and approve external partner account requests."
        actions={
          <Badge tone={pending.length > 0 ? 'warn' : 'muted'}>
            {pending.length} pending
          </Badge>
        }
      />

      <Card>
        <CardHeader
          title="Pending Requests"
          subtitle="New access requests awaiting review"
          action={<Badge tone="warn">{pending.length}</Badge>}
        />

        {loading ? (
          <div className="muted">Loading requests...</div>
        ) : pending.length === 0 ? (
          <EmptyState>No pending partner requests.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Submitted</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.company_name}</strong></td>
                    <td>{r.contact_name}</td>
                    <td>{r.email}</td>
                    <td>{r.phone || '—'}</td>
                    <td>{formatDate(r.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => handleApprove(r.id)}
                          disabled={actionLoading === r.id}
                        >
                          {actionLoading === r.id ? '...' : 'Approve'}
                        </button>
                        <button
                          className="secondary"
                          onClick={() => handleReject(r.id)}
                          disabled={actionLoading === r.id}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {decided.length > 0 && (
        <Card style={{ marginTop: '1rem' }}>
          <CardHeader
            title="History"
            subtitle="Previously reviewed requests"
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Reviewed</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((r) => (
                  <tr key={r.id}>
                    <td>{r.company_name}</td>
                    <td>{r.contact_name}</td>
                    <td>{r.email}</td>
                    <td>
                      <Badge tone={r.status === 'APPROVED' ? 'ok' : 'danger'}>
                        {r.status}
                      </Badge>
                    </td>
                    <td>{r.reviewed_at ? formatDate(r.reviewed_at) : '—'}</td>
                    <td className="muted">{r.rejection_reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
