import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import MobileLayout from '../MobileLayout'
import { Card, MobileEmptyState, MobileListSkeleton, Section } from '../components/Primitives'
import { fetchMobileSummary } from '../../api/mobile'
import { fetchAssignments } from '../../api/assignments'
import { fetchInvoices } from '../../api/invoices'
import { fetchApprovalsInboxCount } from '../../api/approvals'
import { formatDateTime, titleCase } from '../../utils/format'
import { useAuth } from '../../auth/AuthContext'
import { hasCapability, isPartner } from '../../utils/rbac'
import { toUserMessage } from '../../api/client'
import AssociateDemoPromo from '../../components/AssociateDemoPromo'

function QuickCard({ title, value, hint, to }) {
  return (
    <Card className="m-quick-card">
      <p>{title}</p>
      <strong>{value}</strong>
      <small>{hint}</small>
      <Link className="m-card-link" to={to}>Open</Link>
    </Card>
  )
}

export default function HomeScreen() {
  const navigate = useNavigate()
  const { user, capabilities } = useAuth()
  const [summary, setSummary] = useState(null)
  const [drafts, setDrafts] = useState([])
  const [invoiceTotal, setInvoiceTotal] = useState(0)
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const canViewInvoices = hasCapability(capabilities, 'view_invoices')
  const canApprove = hasCapability(capabilities, 'approve_actions')
  const partnerMode = isPartner(user)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        const tasks = [fetchMobileSummary()]

        if (partnerMode) {
          tasks.push(Promise.resolve([]), Promise.resolve({ total: 0 }), Promise.resolve({ pending: 0 }))
        } else {
          tasks.push(fetchAssignments({ completion: 'ALL', mine: true, limit: 20, sort_by: 'updated_at', sort_dir: 'desc' }))
          if (canViewInvoices) {
            tasks.push(fetchInvoices({ unpaid: true, page_size: 1 }))
          } else {
            tasks.push(Promise.resolve({ total: 0 }))
          }
          if (canApprove) {
            tasks.push(fetchApprovalsInboxCount('DRAFT_ASSIGNMENT'))
          } else {
            tasks.push(Promise.resolve({ pending: 0 }))
          }
        }

        const [summaryData, assignmentRows, invoiceData, approvalCount] = await Promise.all(tasks)
        if (cancelled) return

        setSummary(summaryData)
        setDrafts(
          (partnerMode ? (summaryData?.my_queue || []) : (assignmentRows || []))
            .filter((row) => String(row.status || '').startsWith('DRAFT'))
            .slice(0, 6),
        )
        setInvoiceTotal(Number(invoiceData?.total || 0))
        setPendingApprovals(Number(approvalCount?.pending || summaryData?.approvals_pending || 0))
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err, 'Unable to load mobile dashboard.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [canApprove, canViewInvoices, partnerMode])

  const queue = useMemo(() => (Array.isArray(summary?.my_queue) ? summary.my_queue : []), [summary])

  const myDayCount = queue.filter((item) => ['OVERDUE', 'DUE_SOON'].includes(item.due_state)).length
  const uploadsMissing = queue.filter((item) => (item.badges || []).includes('NEEDS_DOCS')).length

  return (
    <MobileLayout
      title={partnerMode ? 'My Requests' : 'My Day'}
      subtitle={user?.full_name || user?.email || 'Maulya'}
      primaryAction={{ label: 'Search', to: '/m/search' }}
    >
      {error ? <div className="m-alert m-alert-error">{error}</div> : null}

      {partnerMode ? <AssociateDemoPromo mobile /> : null}

      <Section title={partnerMode ? 'Today' : 'Priority Queue'} subtitle={partnerMode ? 'Your request and delivery snapshot for today.' : 'Role-aware snapshot for today'}>
        {loading ? <MobileListSkeleton rows={3} /> : null}
        {!loading ? (
          <div className="m-card-grid">
            <QuickCard
              title={partnerMode ? 'Draft Requests' : 'My Drafts'}
              value={drafts.length}
              hint={partnerMode ? 'Requests you started but have not submitted yet' : 'Continue or submit pending draft work'}
              to="/m/assignments?filter=draft"
            />
            {partnerMode ? (
              <QuickCard
                title="Alerts"
                value={Number(summary?.unread_notifications || 0)}
                hint="Updates, clarifications, and payment prompts waiting for you"
                to="/m/notifications"
              />
            ) : (
              <QuickCard
                title="Pending Approvals"
                value={pendingApprovals}
                hint="Approvals that need action now"
                to="/m/approvals"
              />
            )}
            <QuickCard
              title={partnerMode ? 'Due Soon' : 'Today / My Day'}
              value={myDayCount}
              hint={partnerMode ? 'Requests or deliveries that need attention soon' : 'Items that are overdue or due soon'}
              to="/m/assignments?filter=active"
            />
            <QuickCard
              title={partnerMode ? 'Files Needed' : 'Uploads Missing'}
              value={uploadsMissing}
              hint={partnerMode ? 'Requests waiting for site photos or supporting files' : 'Assignments missing checklist evidence'}
              to="/m/uploads"
            />
            {canViewInvoices && !partnerMode ? (
              <QuickCard
                title="Unpaid Invoices"
                value={invoiceTotal}
                hint="Open items waiting for payment flow"
                to="/m/invoices"
              />
            ) : null}
          </div>
        ) : null}
      </Section>

      <Section title={partnerMode ? 'Recent Requests' : 'Queue'} subtitle={`${queue.length} ${partnerMode ? 'items' : 'items'}`}>
        {!loading && queue.length === 0 ? (
          <MobileEmptyState
            title={partnerMode ? 'No active requests' : 'No active queue'}
            body={partnerMode ? 'No submitted or in-progress requests are visible right now.' : 'You are clear for now.'}
            action={<Link className="m-card-link" to="/m/assignments">Browse assignments</Link>}
          />
        ) : null}
        <div className="m-list">
          {queue.slice(0, 8).map((item) => (
            <button
              key={item.id}
              type="button"
              className="m-list-card"
              onClick={() => navigate(`/m/assignments/${item.id}`)}
            >
              <div className="m-list-top">
                <strong>{item.assignment_code || `#${item.id}`}</strong>
                <span className={`m-status ${String(item.due_state || '').toLowerCase()}`}>
                  {titleCase(item.due_state || item.status)}
                </span>
              </div>
              <p>{item.bank_or_client || item.borrower_name || 'Unknown client'}</p>
              <div className="m-list-keyline">
                <span>Due {formatDateTime(item.due_time)}</span>
                <span>Updated {formatDateTime(item.updated_at)}</span>
              </div>
            </button>
          ))}
        </div>
      </Section>
    </MobileLayout>
  )
}
