import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import InfoTip from '../../components/ui/InfoTip'
import PageGrid from '../../components/ui/PageGrid'
import AssociateDemoPromo from '../../components/AssociateDemoPromo'
import { fetchPartnerAssignments, fetchPartnerCommissions, fetchPartnerInvoices, fetchPartnerNotifications } from '../../api/partner'
import { formatDateTime, titleCase } from '../../utils/format'
import { toUserMessage } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { hasCapability } from '../../utils/rbac'
import DemoMissionPanel from '../../demo/tutorial/DemoMissionPanel.jsx'

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
  const { user, capabilities } = useAuth()
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
        if (!cancelled) setError(toUserMessage(err, 'Failed to load associate dashboard'))
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
  const needsProfile = useMemo(() => !(user?.full_name && user?.phone), [user?.full_name, user?.phone])
  const canCreateDraftAssignment = hasCapability(capabilities, 'create_assignment_draft')

  return (
    <div className="partner-console-page">
      <PageHeader
        eyebrow="Associate Workspace"
        title="Associate Dashboard"
        subtitle="Submit valuation requests, respond to clarifications, and track payment and delivery updates."
        actions={(
          <div className="public-actions">
            {canCreateDraftAssignment ? <Link className="nav-link" to="/partner/assignments/new">Create Valuation Case</Link> : null}
            <Link className="nav-link" to="/partner/requests/new">New Request</Link>
          </div>
        )}
      />

      {error ? <div className="alert alert-danger">{error}</div> : null}
      {needsProfile ? (
        <Card className="partner-profile-card">
          <CardHeader title="Complete Profile" subtitle="Finish first-run setup for External Associate access." />
          <div className="surface-note">
            Add your name and phone in profile settings. Optional KYC documents can be uploaded in requests.
            <div style={{ marginTop: 8 }}>
              <Link className="nav-link" to="/partner/profile">Complete Profile</Link>
            </div>
          </div>
        </Card>
      ) : null}

      <AssociateDemoPromo />
      <DemoMissionPanel />

      {loading ? (
        <div className="muted">Loading associate dashboard…</div>
      ) : (
        <>
          <PageGrid cols={{ base: 1, md: 2, lg: 3 }} className="partner-hero-grid">
            <Card className="metric-card">
              <CardHeader
                title="Requests In Progress"
                subtitle="Sent by you and waiting for review"
                action={<Badge tone={inProgressCount > 0 ? 'info' : 'ok'}>{inProgressCount}</Badge>}
              />
              <div className="metric-card-copy">Track requests that are still under review or waiting for more information.</div>
              <div style={{ marginTop: 12 }}>
                <Link className="nav-link" to="/partner/requests">View Requests</Link>
              </div>
            </Card>

            <Card className="metric-card">
              <CardHeader
                title="Payments Pending"
                subtitle="Invoices that still need your action"
                action={<Badge tone={paymentPendingCount > 0 ? 'warn' : 'ok'}>{paymentPendingCount}</Badge>}
              />
              <div className="metric-card-copy">Submit proof of payment so reports and final files can be released.</div>
              <div style={{ marginTop: 12 }}>
                <Link className="nav-link" to="/partner/payments">Open Payments</Link>
              </div>
            </Card>

            <Card className="metric-card">
              <CardHeader
                title="Reports Ready"
                subtitle="Files unlocked after payment verification"
                action={<Badge tone={reportsReadyCount > 0 ? 'ok' : 'muted'}>{reportsReadyCount}</Badge>}
              />
              <div className="metric-card-copy">Download-ready deliverables appear here after finance verification is complete.</div>
              <div style={{ marginTop: 12 }}>
                <Link className="nav-link" to="/partner/requests">Go to Requests</Link>
              </div>
            </Card>
          </PageGrid>

          <div className="partner-stream-grid">
            <Card>
              <CardHeader
                title="Latest Updates"
                subtitle="Recent status changes, document asks, and payment prompts."
                action={<Link className="nav-link" to="/partner/notifications">All Notifications</Link>}
              />

              {notifications.length === 0 ? (
                <EmptyState
                  title="No updates yet"
                  body="Status changes, payment prompts, and request follow-ups will appear here as soon as the workspace starts moving."
                />
              ) : (
                <div className="list">
                  {notifications.map((note) => (
                    <Link key={note.id} to={notificationLink(note)} className="partner-list-link">
                      <div className="list-item">
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{titleCase(note.type || 'Update')}</div>
                          <div className="muted" style={{ marginTop: 4 }}>{note.message}</div>
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>{formatDateTime(note.created_at)}</div>
                      </div>
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
                <EmptyState
                  title="No commission requests yet"
                  body="Start with your first request to unlock payment tracking, document prompts, and delivery milestones."
                  action={<Link className="nav-link" to="/partner/requests/new">Create Request</Link>}
                />
              ) : (
                <div className="list">
                  {commissions.slice(0, 5).map((commission) => (
                    <Link key={commission.id} to={`/partner/requests/${commission.id}`} className="partner-list-link">
                      <div className="list-item">
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{commission.request_code}</div>
                          <div className="muted" style={{ fontSize: 12 }}>{commission.borrower_name || commission.bank_name || 'Commission request'}</div>
                        </div>
                        <Badge tone={statusTone(commission.status)}>{titleCase(commission.status)}</Badge>
                      </div>
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
