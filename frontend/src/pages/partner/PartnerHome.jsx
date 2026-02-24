import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import InfoTip from '../../components/ui/InfoTip'
import PageGrid from '../../components/ui/PageGrid'
import { fetchPartnerAssignments, fetchPartnerCommissions, fetchPartnerInvoices, fetchPartnerNotifications } from '../../api/partner'
import { formatDateTime, titleCase } from '../../utils/format'
import { toUserMessage } from '../../api/client'

function statusTone(status) {
  if (!status) return 'muted'
  if (status === 'NEEDS_INFO') return 'warn'
  if (status === 'SUBMITTED') return 'info'
  if (status === 'APPROVED' || status === 'CONVERTED') return 'ok'
  if (status === 'REJECTED') return 'danger'
  return 'muted'
}

function notificationLink(notification) {
  const payload = notification.payload_json || {}
  if (payload.commission_request_id) return `/partner/requests/${payload.commission_request_id}`
  if (payload.assignment_id) return '/partner/payments'
  if (payload.invoice_id) return '/partner/payments'
  return '/partner/notifications'
}

export default function PartnerHome() {
  const [commissions, setCommissions] = useState([])
  const [assignments, setAssignments] = useState([])
  const [invoices, setInvoices] = useState([])
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [commissionData, assignmentData, invoiceData, notifData] = await Promise.all([
          fetchPartnerCommissions().catch(() => []),
          fetchPartnerAssignments().catch(() => []),
          fetchPartnerInvoices().catch(() => []),
          fetchPartnerNotifications({ limit: 8 }).catch(() => []),
        ])
        if (cancelled) return
        setCommissions(commissionData)
        setAssignments(assignmentData)
        setInvoices(invoiceData)
        setNotifications(notifData)
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load partner dashboard'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const inProgressCount = useMemo(() => (
    commissions.filter((c) => ['SUBMITTED', 'NEEDS_INFO'].includes(c.status)).length
  ), [commissions])

  const paymentPendingCount = useMemo(() => invoices.filter((inv) => !inv.is_paid).length, [invoices])

  const reportsReadyCount = useMemo(() => assignments.filter((a) => a.payment_status === 'VERIFIED').length, [assignments])

  return (
    <div>
      <PageHeader
        title="Partner Console"
        subtitle="Submit new commissions, respond to requests, and track payments in one place."
        actions={(
          <Link className="nav-link" to="/partner/requests/new">New Commission Request</Link>
        )}
      />

      {error ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{error}</div> : null}

      {loading ? (
        <div className="muted">Loading partner dashboard…</div>
      ) : (
        <>
          <PageGrid cols={{ base: 1, md: 2, lg: 3 }} style={{ marginBottom: '1rem' }}>
            <Card>
              <CardHeader
                title="Requests In Progress"
                subtitle="Submitted and awaiting action"
                action={<Badge tone={inProgressCount > 0 ? 'info' : 'ok'}>{inProgressCount}</Badge>}
              />
              <div className="muted">Track submitted commissions and document requests.</div>
              <div style={{ marginTop: 12 }}>
                <Link className="nav-link" to="/partner/requests">View Requests</Link>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Payments Pending"
                subtitle="Invoices awaiting verification"
                action={<Badge tone={paymentPendingCount > 0 ? 'warn' : 'ok'}>{paymentPendingCount}</Badge>}
              />
              <div className="muted">Upload payment proof to unlock deliverables.</div>
              <div style={{ marginTop: 12 }}>
                <Link className="nav-link" to="/partner/payments">Open Payments</Link>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Reports Ready"
                subtitle="Verified payments with deliverables"
                action={<Badge tone={reportsReadyCount > 0 ? 'ok' : 'muted'}>{reportsReadyCount}</Badge>}
              />
              <div className="muted">Final reports unlock after payment verification.</div>
              <div style={{ marginTop: 12 }}>
                <Link className="nav-link" to="/partner/requests">Go to Requests</Link>
              </div>
            </Card>
          </PageGrid>

          <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
            <Card>
              <CardHeader
                title="Latest Updates"
                subtitle="Recent status changes and requests from the team."
                action={<Link className="nav-link" to="/partner/notifications">All Notifications</Link>}
              />

              {notifications.length === 0 ? (
                <EmptyState>No updates yet.</EmptyState>
              ) : (
                <div className="list">
                  {notifications.map((note) => (
                    <Link key={note.id} to={notificationLink(note)} className="list-item">
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{titleCase(note.type || 'Update')}</div>
                          <div className="muted" style={{ marginTop: 4 }}>{note.message}</div>
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>{formatDateTime(note.created_at)}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Active Requests"
                subtitle="Most recent submissions"
                action={<InfoTip text="Use My Requests to track all commissions." />}
              />
              {commissions.length === 0 ? (
                <EmptyState>No commission requests yet.</EmptyState>
              ) : (
                <div className="list">
                  {commissions.slice(0, 5).map((commission) => (
                    <Link key={commission.id} to={`/partner/requests/${commission.id}`} className="list-item">
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{commission.request_code}</div>
                          <div className="muted" style={{ fontSize: 12 }}>{commission.borrower_name || commission.bank_name || 'Commission request'}</div>
                        </div>
                        <Badge tone={statusTone(commission.status)}>{titleCase(commission.status)}</Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
